import React, { useEffect, useState, useRef } from "react";
import { db } from "../firebaseConfig";
import {
  collection, query, where, getDocs, limit
} from "firebase/firestore";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// ─────────────────────────────────────────────────────────────────────────────

const ShowQtyByMonth = () => {
  const [monthlyData, setMonthlyData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedFactory, setSelectedFactory] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [allFactories, setAllFactories] = useState([]);
  const [readCount, setReadCount] = useState(0);

  const cache = useRef({});

  // ── Fetch summary ─────────────────────────────────────────────────────────
  const fetchSummary = async (year) => {
    setLoading(true);

    if (cache.current[year]) {
      const c = cache.current[year];
      setMonthlyData(c.rows);
      setAllFactories(c.factories);
      setReadCount(0);
      setLoading(false);
      return;
    }

    try {
      const q = query(
        collection(db, "TblDispatchMonthly"),
        where("year", "==", year),
        limit(500)
      );
      const snap = await getDocs(q);
      console.log(`📊 TblDispatchMonthly reads for ${year}: ${snap.size}`);
      setReadCount(snap.size);

      const rows = snap.docs.map(d => {
        const data = d.data();
        const totalQty = Number(data.totalQty) || 0;
        const billQty = Number(data.billQty) || 0;
        const monthNum = Number(data.month) || 1;
        return {
          Factory: (data.factory || "UNKNOWN").toUpperCase().trim(),
          MonthName: MONTHS[monthNum - 1],
          monthIndex: monthNum - 1,
          monthNum,
          year: Number(data.year),
          totalQty,
          BillQty: billQty,
          Balance: totalQty - billQty,
        };
      });

      rows.sort((a, b) => {
        if (a.Factory < b.Factory) return -1;
        if (a.Factory > b.Factory) return 1;
        return a.monthNum - b.monthNum;
      });

      const factories = [...new Set(rows.map(r => r.Factory))].sort();
      cache.current[year] = { rows, factories };

      setMonthlyData(rows);
      setAllFactories(factories);
    } catch (err) {
      console.error("Error fetching TblDispatchMonthly:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSummary(selectedYear); }, [selectedYear]);

  // ── Filter ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let data = monthlyData;
    if (selectedFactory) data = data.filter(r => r.Factory === selectedFactory);
    if (selectedMonth) data = data.filter(r => r.monthNum === parseInt(selectedMonth));
    setFilteredData(data);
  }, [selectedFactory, selectedMonth, monthlyData]);



  // ── Helpers ───────────────────────────────────────────────────────────────
  const getAvailableYears = () => {
    const cur = new Date().getFullYear();
    const arr = [];
    for (let y = cur - 5; y <= cur; y++) arr.push(y);
    return arr;
  };

  const calculateTotals = () =>
    filteredData.reduce(
      (acc, item) => ({ totalQty: acc.totalQty + item.totalQty, BillQty: acc.BillQty + item.BillQty, Balance: acc.Balance + item.Balance }),
      { totalQty: 0, BillQty: 0, Balance: 0 }
    );

  const handleRefresh = () => {
    if (!window.confirm(`Refresh data for ${selectedYear}?`)) return;
    delete cache.current[selectedYear];
    setSelectedFactory("");
    setSelectedMonth("");
    fetchSummary(selectedYear);
  };

  const fmt = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  const inputStyle = { padding: "8px 12px", border: "1px solid #ccc", borderRadius: 4, fontSize: 15, minWidth: 170, backgroundColor: "#fff" };
  const labelStyle = { fontWeight: "bold", fontSize: 14, marginBottom: 4, display: "block", color: "#444" };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <h3>Loading monthly quantity report…</h3>
        <p>Fetching summary for {selectedYear}…</p>
      </div>
    );
  }

  const totals = calculateTotals();
  const isEmpty = monthlyData.length === 0;

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ textAlign: "center", marginBottom: 24 }}>Quantity By Month</h1>

      {/* ── Info bar ───────────────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: "#f8f9fa", padding: "10px 14px", borderRadius: 5,
        marginBottom: 20, fontSize: 13, display: "flex", flexWrap: "wrap",
        gap: 18, alignItems: "center"
      }}>
        <span><strong>Year:</strong> {selectedYear}</span>
        <span>
          <strong>Reads:</strong>&nbsp;
          <span style={{ color: readCount === 0 ? "#28a745" : "#007bff", fontWeight: "bold" }}>
            {readCount === 0 ? "0 (cached ✨)" : readCount}
          </span>
        </span>
        <span><strong>Rows:</strong> {monthlyData.length}</span>
        <button onClick={handleRefresh} style={{
          marginLeft: "auto", padding: "5px 12px", backgroundColor: "#007bff",
          color: "white", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12
        }}>🔄 Refresh</button>
      </div>



      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end",
        marginBottom: 24, padding: 16, backgroundColor: "#fff",
        border: "1px solid #dee2e6", borderRadius: 6
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>📅 Year</label>
          <select
            value={selectedYear}
            onChange={e => { setSelectedYear(parseInt(e.target.value)); setSelectedFactory(""); setSelectedMonth(""); }}
            style={inputStyle}
          >
            {getAvailableYears().map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>🏭 Factory</label>
          <select
            value={selectedFactory}
            onChange={e => setSelectedFactory(e.target.value)}
            style={inputStyle}
          >
            <option value="">All Factories</option>
            {allFactories.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>📆 Month</label>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={inputStyle}
          >
            <option value="">All Months</option>
            {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>

        {(selectedFactory || selectedMonth) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ ...labelStyle, visibility: "hidden" }}>_</label>
            <button
              onClick={() => { setSelectedFactory(""); setSelectedMonth(""); }}
              style={{ padding: "8px 16px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}
            >✕ Clear</button>
          </div>
        )}
      </div>

      {/* ── Table / No-data message ────────────────────────────────────────── */}
      {!isEmpty && filteredData.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", backgroundColor: "#f8f9fa", borderRadius: 8, border: "1px dashed #ccc" }}>
          <h3>No data for {selectedFactory && `${selectedFactory} › `}{selectedMonth && `${MONTHS[parseInt(selectedMonth) - 1]} › `}{selectedYear}</h3>
          <button onClick={() => { setSelectedFactory(""); setSelectedMonth(""); }}
            style={{ marginTop: 10, padding: "8px 20px", backgroundColor: "#007bff", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Show All
          </button>
        </div>
      ) : !isEmpty && (
        <>
          <div style={{
            marginBottom: 12, padding: "10px 14px", backgroundColor: "#e7f3ff",
            borderRadius: 5, display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            <span>
              Showing <strong>{filteredData.length}</strong> record(s)
              {selectedFactory && <> · <strong>{selectedFactory}</strong></>}
              {selectedMonth && <> · <strong>{MONTHS[parseInt(selectedMonth) - 1]}</strong></>}
            </span>
            {(selectedFactory || selectedMonth) && (
              <button onClick={() => { setSelectedFactory(""); setSelectedMonth(""); }}
                style={{ padding: "4px 10px", backgroundColor: "#6c757d", color: "white", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 13 }}>
                Clear Filters
              </button>
            )}
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#343a40", color: "white" }}>
                  {["Factory", "Month", "Total Quantity", "Bill Quantity", "Balance"].map(h => (
                    <th key={h} style={{ padding: "12px 14px", textAlign: (h === "Factory" || h === "Month") ? "left" : "right", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, i) => (
                  <tr key={`${item.Factory}-${item.MonthName}-${i}`}
                    style={{ backgroundColor: i % 2 === 0 ? "#fff" : "#f9f9f9" }}>
                    <td style={{ padding: "11px 14px", border: "1px solid #dee2e6", fontWeight: "bold" }}>{item.Factory}</td>
                    <td style={{ padding: "11px 14px", border: "1px solid #dee2e6" }}>{item.MonthName}</td>
                    <td style={{ padding: "11px 14px", border: "1px solid #dee2e6", textAlign: "right" }}>{fmt(item.totalQty)}</td>
                    <td style={{ padding: "11px 14px", border: "1px solid #dee2e6", textAlign: "right" }}>{fmt(item.BillQty)}</td>
                    <td style={{ padding: "11px 14px", border: "1px solid #dee2e6", textAlign: "right", fontWeight: "bold", color: item.Balance >= 0 ? "#28a745" : "#dc3545" }}>
                      {fmt(item.Balance)}
                    </td>
                  </tr>
                ))}
                <tr style={{ backgroundColor: "#e9ecef", fontWeight: "bold" }}>
                  <td style={{ padding: "12px 14px", border: "1px solid #dee2e6" }} colSpan={2}>TOTAL</td>
                  <td style={{ padding: "12px 14px", border: "1px solid #dee2e6", textAlign: "right" }}>{fmt(totals.totalQty)}</td>
                  <td style={{ padding: "12px 14px", border: "1px solid #dee2e6", textAlign: "right" }}>{fmt(totals.BillQty)}</td>
                  <td style={{ padding: "12px 14px", border: "1px solid #dee2e6", textAlign: "right", color: totals.Balance >= 0 ? "#28a745" : "#dc3545" }}>{fmt(totals.Balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 30, display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { label: "Total Dispatch", value: totals.totalQty, bg: "#007bff" },
              { label: "Total Billed", value: totals.BillQty, bg: "#28a745" },
              { label: "Total Balance", value: totals.Balance, bg: totals.Balance >= 0 ? "#17a2b8" : "#dc3545" },
            ].map(card => (
              <div key={card.label} style={{ backgroundColor: card.bg, color: "white", padding: "20px 28px", borderRadius: 8, minWidth: 200, textAlign: "center", flex: 1 }}>
                <h4 style={{ margin: "0 0 8px", fontWeight: 500 }}>{card.label}</h4>
                <h3 style={{ margin: 0, fontSize: 26 }}>{fmt(card.value)}</h3>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ShowQtyByMonth;