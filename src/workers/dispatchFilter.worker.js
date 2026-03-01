const formatShortDate = (timestamp) => {
    if (!timestamp) return "";
    const d = new Date(timestamp);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = d.getFullYear().toString().slice(-2);
    return `${dd}-${mm}-${yy}`;
};

let DATA_COLS = {};
let INDEX = {};
let ROW_COUNT = 0;
let COL_NAMES = [];
let QUERY_CACHE = {};

function buildDataAndIndex(rows) {
    ROW_COUNT = rows.length;
    if (ROW_COUNT === 0) {
        DATA_COLS = {};
        INDEX = {};
        QUERY_CACHE = {};
        return;
    }

    // Auto-detect columns from first row
    COL_NAMES = Object.keys(rows[0]);
    DATA_COLS = {};
    COL_NAMES.forEach(col => {
        DATA_COLS[col] = new Array(ROW_COUNT);
    });

    INDEX = {};
    QUERY_CACHE = {};

    for (let i = 0; i < ROW_COUNT; i++) {
        const r = rows[i];

        COL_NAMES.forEach(col => {
            let val = r[col];

            // Store raw values or timestamps for dates in columns
            if (val instanceof Date) {
                DATA_COLS[col][i] = val.getTime();
            } else {
                DATA_COLS[col][i] = val;
            }

            if (!val) return;

            let stringValue = '';
            if (val instanceof Date) {
                stringValue = formatShortDate(val.getTime());
            } else {
                stringValue = val.toString();
            }

            const words = stringValue.toLowerCase().split(/\s+/);
            words.forEach(w => {
                if (!w) return;
                if (!INDEX[w]) INDEX[w] = [];
                INDEX[w].push(i);
            });
        });
    }
}

function buildRow(i) {
    const row = {};
    COL_NAMES.forEach(col => {
        let val = DATA_COLS[col][i];
        // Rehydrate Dates if the column holds timestamps and looks like a Date
        if (typeof val === 'number' && col.toLowerCase().includes('date') && val > 0) {
            row[col] = new Date(val);
        } else {
            row[col] = val;
        }
    });
    return row;
}

self.onmessage = function (e) {
    const { type, data, searchTerm, seq } = e.data;

    if (type === "SET_DATA") {
        buildDataAndIndex(data || []);

        if (searchTerm) {
            performSearch(searchTerm, seq);
        } else {
            const allRows = [];
            for (let i = 0; i < ROW_COUNT; i++) allRows.push(buildRow(i));
            self.postMessage({ type: "SET_DATA_DONE", seq: seq || 0, results: allRows });
        }
        return;
    }

    if (type === "SEARCH") {
        performSearch(searchTerm, seq);
    }
};

function performSearch(searchTerm, seq) {
    if (!searchTerm || !searchTerm.trim()) {
        const allRows = [];
        for (let i = 0; i < ROW_COUNT; i++) allRows.push(buildRow(i));
        self.postMessage({ seq, results: allRows });
        return;
    }

    const term = searchTerm.toLowerCase().trim();

    if (QUERY_CACHE[term]) {
        self.postMessage({ seq, results: QUERY_CACHE[term] });
        return;
    }

    const terms = term.split(/\s+/).filter(Boolean);

    let resultIndexes = null;

    terms.forEach(t => {
        // Support partial matching against inverted index keys
        const hitKeys = Object.keys(INDEX).filter(k => k.includes(t));

        let hits = [];
        hitKeys.forEach(k => {
            hits.push(...INDEX[k]);
        });

        // Deduplicate hit array
        hits = [...new Set(hits)];

        if (resultIndexes === null) {
            resultIndexes = new Set(hits);
        } else {
            resultIndexes = new Set(
                [...resultIndexes].filter(x => hits.includes(x))
            );
        }
    });

    const result = resultIndexes ? [...resultIndexes].map(i => buildRow(i)) : [];

    QUERY_CACHE[term] = result;
    self.postMessage({ seq, results: result });
}
