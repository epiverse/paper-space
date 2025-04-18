import { State } from "./State.js";
import { Tabulator, SelectRowModule, FormatModule } from 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.2.1/+esm';

Tabulator.registerModule([SelectRowModule, FormatModule]);

const CATEGORICAL_COLOR_SCHEME = [
  "#4269d0", 
  "#efb118",
  "#ff725c", 
  "#6cc5b0",
  "#3ca951",
  "#ff8ab7",
  "#a463f2",
  "#97bbf5", 
  "#9c6b4e", 
];

// TODO: Add font-awesome icons
const FILTER_CONFIG = [
  { property: "authors", type: "array" },
  { property: "keywords", type: "array" },
  { property: "branches", type: "array" },
  { property: "year", type: "number" },
  { property: "firstAuthor", type: "string"},
];

const DOCUMENT_TITLE_FIELD = "paperKey";
const TOOLTIP_TEMPLATE = `%{customdata.${DOCUMENT_TITLE_FIELD}} <extra></extra>`;


class Application {
  constructor() {
    this.init();
  }

  async init() {
    this.state = new State();
    this.state.defineProperty("selection", null);
    this.state.defineProperty("filters", []);
    this.state.defineProperty("highlight", new Set());

    this.elems = {
      propertySearch: document.getElementById("property-search"),
      filterContainer: document.getElementById("filter-container"),
      plotContainer: document.getElementById("plot-container"),
      resetButton: document.getElementById("clear-button"),
      document: document.getElementById("document"),
      documentContent: document.getElementById("document-content"),
      documentHeading: document.getElementById("document-heading"),
      documentTable: document.getElementById("document-table"),
    };

    this.data = await (await fetch("../paper-space/data/dceg_publications.json")).json();
    this.matches = this.data.map(d => ({dataRow: d, match: false}));
    this.dataIndex = new Map(this.data.map(d => [d.id, d]));
    this.setupFilters();
    this.hookSearch();
    this.initPlot();
    this.updateTable();

    this.filterColorMap = new Map();

    this.state.subscribe("filters", () => this.listenFilters());
    this.state.subscribe("selection", () => this.listenSelection());
    this.state.subscribe("highlight", () => this.listenHighlight());

    this.elems.resetButton.addEventListener("click", () => {
      this.state.filters = [];
      this.state.selection = null;
    });
  }

  setupFilters() {
    this.filterData = [];
    for (const filterConfig of FILTER_CONFIG) {
      const values = new Set();
      for (const row of this.data) {
        const propertyValue = row.properties[filterConfig.property];
        if (propertyValue != null) {
          if (filterConfig.type == "array") {
            for (const value of propertyValue) {
              values.add(value);
            }
          } else {
            values.add(propertyValue);
          }
        }
       
      } 
      for (const value of values) {
        this.filterData.push( { value, property: filterConfig.property });
      }
    }
  }

  listenFilters() {
    this.filterColorMap = new Map(this.state.filters.map((d,i) =>
      [d.key, CATEGORICAL_COLOR_SCHEME[i % CATEGORICAL_COLOR_SCHEME.length]]));

    this.matches = this.data.map(row => {
      const filterRow = { dataRow: row, match: false };

      if (this.state.filters) {
        const matches = [];
        for (const filter of this.state.filters) {
          if (filter.type == "array") {
            const valueSet = new Set(row.properties[filter.property]);
            if (valueSet.has(filter.value)) {
              matches.push(filter);
            }
          } else {
            if (filter.value == row.properties[filter.property]) {
              matches.push(filter);
            }
          }
        }
        if (matches.length > 0) {
          filterRow.match = matches;
        }
      } else {
        filterRow.match = true;
      }

      return filterRow;
    });

    this.elems.filterContainer.innerHTML = '';
    for (const [filterKey, color] of this.filterColorMap.entries()) {
      const filterElement = document.createElement("span");
      filterElement.style.backgroundColor = color;
      filterElement.classList.add("filter-tag");
      filterElement.innerText = filterKey;
      this.elems.filterContainer.appendChild(filterElement);
    }
    this.toggleButton(this.elems.resetButton, this.state.filters.length > 0 || this.state.selection != null);

    this.updatePlot();
    this.updateTable();
  }
  
  listenSelection() {
    if (this.state.selection) {
      this.elems.document.classList.add("active");

      const row = this.dataIndex.get(this.state.selection)
      this.elems.documentHeading.innerText = row.properties[DOCUMENT_TITLE_FIELD];
      this.elems.documentContent.innerText = row.text;

      this.distances = this.data.map(d => ({
        dataRow: d, distance: euclideanDistance(d.embeddings[0].vector, row.embeddings[0].vector)}));
      this.distances.sort((a,b) => a.distance - b.distance);
      
      this.state.highlight = new Set(this.distances.slice(0, 16).map(d => d.dataRow.id));
    } else {
      this.elems.document.classList.remove("active");
      this.state.highlight = new Set();
    }
    this.updateTable();

    this.toggleButton(this.elems.resetButton, this.state.filters.length > 0 || this.state.selection != null);
  }

  updateTable() {
    let tableRows; 
    let tableColumns;

    const matchIndex = new Map(this.matches.map(d => [d.dataRow.id, d]));
    const nameFormatter = (cell, params, onRendered) => {
      const cellElement = document.createElement("div");
      cellElement.style.display = "flex";
      cellElement.style.gap = "5px";
      const tableRow = cell._cell.row.data;
      const matches = matchIndex.get(tableRow.id);

      if (matches.match) {
        const matchTagContainer = document.createElement("div");
        matchTagContainer.style.display = "flex";
        matchTagContainer.style.gap = "2px";
  
        for (const match of matches.match) {
          const matchTagElement = document.createElement("span");
          matchTagElement.style.width = "8px";
          matchTagElement.style.height = "16px";
          matchTagElement.style.backgroundColor = this.filterColorMap.get(match.key);
          matchTagElement.style.borderRadius = "5px";
          matchTagContainer.appendChild(matchTagElement);
        }
  

        const cellText = document.createElement("span");
        cellText.innerText = cell._cell.value;

        cellElement.appendChild(matchTagContainer);
        cellElement.appendChild(cellText);
      } else {
        cellElement.innerText = cell._cell.value;
      }
      
  
      return cellElement
    }

    if (this.state.selection) {
      tableRows = this.distances.slice(1).map(d => ({
        id: d.dataRow.id,
        name: d.dataRow.properties.paperKey,
        distance: parseFloat(d.distance.toFixed(3)),
        dataRow: d.dataRow
      }));

      tableColumns = [
        { field: "name", title: "Paper", formatter: nameFormatter},
        { field: "distance", title: "Distance"}
      ];
    } else {
      tableRows = this.data.map(d => ({
        id: d.id,
        name: d.properties.paperKey,
        dataRow: d
      }));

      tableColumns = [
        { field: "name", title: "Paper", formatter: nameFormatter},
      ];
    }

    console.log(tableColumns)
    const table = new Tabulator(this.elems.documentTable, {
      selectableRows: 1,
      data: tableRows, 
      columns: tableColumns,
      layout: "fitColumns",
    });
    table.on("rowSelectionChanged", (data, rows, selected) => {
      this.state.selection = selected[0]._row.data.id;
    });
  }

  listenHighlight() {
    this.updatePlot();
  }

  initPlot() {
    const trace1 = {
      x: this.data.map(d => d.embeddings[1].vector[0]),
      y: this.data.map(d => d.embeddings[1].vector[1]),
      z: this.data.map(d => d.embeddings[1].vector[2]),
      mode: 'markers',
      type: 'scatter3d',
      customdata: this.data.map(d => d.properties),
      hovertemplate: TOOLTIP_TEMPLATE,
      marker: {
        size: this.data.map(d => 6),
        color: this.data.map(d => "lightgrey")
      },
      showlegend: false 
    };

    const axisLineStyle = {
      mode: 'lines',
      type: 'scatter3d',
      line: {
        color: 'grey',
        width: 1 
      },
      hoverinfo: 'none',
      showlegend: false,
    };

    const axisTraces = [];
    ["x", "y", "z"].forEach((axis,i) => {
      const max = Math.max(...this.data.map(d => Math.abs(d.embeddings[1].vector[i])));
      const axisTrace = {
        ...axisLineStyle, 
        x: [0, 0],
        y: [0, 0],
        z: [0, 0],
      };
      axisTrace[axis] = [-max, max];
      axisTraces.push(axisTrace);
    })

    const zoom = .7 // It's like a reverse zoom 
    const layout  = {
      autosize: true, 
      margin: { 
          l: 10,
          r: 10,
          b: 10,
          t: 10, 
          pad: 4
      },
      scene: {
        aspectmode: 'data',
        camera: {
          eye: { x: zoom, y: zoom, z: zoom }
        },
        xaxis: {
          title: {text: ''}, 
          showgrid: false,
          showline: false, 
          showticklabels: false, 
          zeroline: false,     
          zerolinecolor: 'black',
          zerolinewidth: 2,  
          showbackground: false,
          showspikes: false       
      },
      yaxis: {
          title: {text: ''},
          showgrid: false,
          showline: false,
          showticklabels: false,
          zeroline: false, 
          zerolinecolor: 'black',
          zerolinewidth: 2,
          showbackground: false,
          showspikes: false  
      },
      zaxis: {
          title: {text: ''},
          showgrid: false,
          showline: false,
          showticklabels: false,
          zeroline: false, 
          zerolinecolor: 'black',
          zerolinewidth: 2,
          showbackground: false,
          showspikes: false  
        }
      }
    };

    Plotly.newPlot(this.elems.plotContainer, [trace1, ...axisTraces], layout, { 
      responsive: true,
      displayModeBar: false,
    });

    this.elems.plotContainer.on("plotly_click", e => {
      if (e.points[0].customdata) {
        this.state.selection = e.points[0].customdata.id;
      }
    })
  }

  updatePlot() {
    const colorFunction = (row) => {
      if (row.match) {
        // TODO: Support multi-matching
        return this.filterColorMap.get(row.match[0].key);
      } else if (this.state.highlight.has(row.dataRow.id)) {
        return "#bdbdbd";
      } else {
        return "#d9d9d9";
      }
    }

    const newColors = this.matches.map(colorFunction);
    const opacities = this.matches.map(d => this.state.highlight.has(d.dataRow.id) ? 1 : .2);
    const sizes = this.matches.map(d => this.state.highlight.has(d.dataRow.id) ? 9 : 5);


    const updateData = {
      'marker.color': [newColors],
      "marker.size": [sizes],
      "marker.opacity": [opacities],
    };
    Plotly.restyle(this.elems.plotContainer, updateData, [0]);
  }

  toggleButton(button, enabled) {
    if (enabled) {
      button.removeAttribute("disabled");
      button.className = "text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 dark:bg-blue-600 dark:hover:bg-blue-700 focus:outline-none dark:focus:ring-blue-800 shrink-0";
    } else {
      button.setAttribute("disabled", "");
      button.className = "text-white bg-blue-400 dark:bg-blue-500 cursor-not-allowed font-medium rounded-lg text-sm px-5 py-2.5 text-center shrink-0";
    }
  }

  hookSearch() {
    new autoComplete({
      selector: "#property-search",

      placeHolder: "Search for authors, branches, keywords...",
      data: {
        src: this.filterData,
        keys: ["value"],
      },

  
      resultItem: {
        element: (item, data) => {
          item.style = "display: flex; justify-content: space-between;";
          item.innerHTML = `
          <span style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">
            ${data.match}
          </span>
          <span style="display: flex; align-items: center; font-size: 13px; font-weight: 100; text-transform: uppercase; color: rgba(0,0,0,.2);">
            ${data.value.property}
          </span>`;
        },
        highlight: true,
      },

      resultsList: {
        maxResults: 100,
      },

      events: {
        input: {
          selection: e => {
            const selectionValue = e.detail.selection.value;
            const filter = { 
              key: `${selectionValue.property}:${selectionValue.value}`,
              ...FILTER_CONFIG.find(d => d.property == selectionValue.property),
              value: selectionValue.value,
            };
            this.state.filters.push(filter);
            this.state.trigger("filters");
            this.elems.propertySearch.value = '';
          }
        }
      }
    });
  }


}

function euclideanDistance(pointA, pointB) {
  let sumOfSquares = 0;
  for (let i = 0; i < pointA.length; i++) {
    sumOfSquares += (pointA[i] - pointB[i]) ** 2;
  }
  return Math.sqrt(sumOfSquares);
}

new Application();

