import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

/* ===== SAFE DATE ===== */
const toDate = (v) => {
  if (!v) return null;
  if (v.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===== SAFE NUMBER ===== */
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== DATE FORMAT HELPERS (dd-MM-yyyy) ===== */
const formatDDMMYYYY = (date) => {
  if (!date) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
};

const parseDDMMYYYY = (ddmmyyyy) => {
  if (!ddmmyyyy) return null;
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const ShowBill = () => {
  const [rows, setRows] = useState([]);
  const [dispatchRows, setDispatchRows] = useState({});
  const [selectedBillId, setSelectedBillId] = useState(null);

  /* ===== FILTER STATES ===== */
  const [searchBill, setSearchBill] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");

  /* ================= LOAD DATA ================= */
  const load = async () => {
    const billSnap = await getDocs(collection(db, "BillTable"));
    const dispSnap = await getDocs(collection(db, "TblDispatch"));

    const billMap = {};
    billSnap.docs.forEach(b => (billMap[b.id] = b.data()));

    const reportMap = {};
    const dispatchMap = {};

    dispSnap.docs.forEach(d => {
      const r = d.data();
      if (!r.BillID || !billMap[r.BillID]) return;

      const bill = billMap[r.BillID];
      const dispatchDate = toDate(r.DispatchDate);
      const billDate = toDate(bill.BillDate);

      const billDateStr = billDate ? formatDDMMYYYY(billDate) : "";

      if (!dispatchMap[r.BillID]) dispatchMap[r.BillID] = [];

      dispatchMap[r.BillID].push({
        id: d.id,
        ChallanNo: r.ChallanNo || "",
        DispatchDate: dispatchDate
          ? formatDDMMYYYY(dispatchDate)
          : "",
        Quantity: toNum(r.DispatchQuantity),
        UnitPrice: toNum(r.UnitPrice),
        FinalPrice: toNum(r.FinalPrice),
        VehicleNo: r.VehicleNo || "",
        LRNo: r.LRNo || "",
        DeliveryNum: r.DeliveryNum || ""
      });

      if (!reportMap[r.BillID]) {
        reportMap[r.BillID] = {
          BillID: r.BillID,
          Factory: bill.FactoryName || "",
          "Bill Num": bill.BillNum || "",
          "Bill Date": billDateStr,
          BillDateObj: billDateStr ? parseDDMMYYYY(billDateStr) : null,
          "LR Qty": 0,
          "Bill Qty": 0,
          TAXABLE: 0,
          FINAL_RAW: 0,
          "Bill Type": bill.BillType || ""
        };
      }

      reportMap[r.BillID]["LR Qty"] += 1;
      reportMap[r.BillID]["Bill Qty"] += toNum(r.DispatchQuantity);
      reportMap[r.BillID].TAXABLE +=
        toNum(r.DispatchQuantity) * toNum(r.UnitPrice);
      reportMap[r.BillID].FINAL_RAW += toNum(r.FinalPrice);
    });

    const result = Object.values(reportMap).map(r => {
      const taxable = r.TAXABLE;
      const finalRaw = r.FINAL_RAW;

      const hasDeduction = finalRaw > 0 && finalRaw < taxable;
      const base = hasDeduction ? finalRaw : taxable;

      return {
        ...r,
        "Bill Qty": r["Bill Qty"].toFixed(2),
        TAXABLE: taxable.toFixed(2),
        TDS: (base * 0.00984).toFixed(2),
        GST: (base * 0.18).toFixed(2),
        "Act. Amt": (base * 1.18).toFixed(2),
        "Final Price": hasDeduction ? finalRaw.toFixed(2) : "0.00"
      };
    });

    setRows(result);
    setDispatchRows(dispatchMap);
  };

  useEffect(() => {
    load();
  }, []);

  /* ================= FILTER LOGIC ================= */
  const filteredRows = useMemo(() => {
    let data = [...rows];

    if (searchBill.trim()) {
      const tokens = searchBill.toLowerCase().split(/\s+/);
      data = data.filter(r =>
        tokens.every(t =>
          (r.Factory || "").toLowerCase().includes(t) ||
          (r["Bill Num"] || "").toLowerCase().includes(t) ||
          (r["Bill Date"] || "").toLowerCase().includes(t)
        )
      );
    }

    if (fromDate || toDateFilter) {
      const from = fromDate ? startOfDay(new Date(fromDate)) : null;
      const to = toDateFilter ? endOfDay(new Date(toDateFilter)) : null;

      data = data.filter(r => {
        if (!r.BillDateObj) return false;
        if (from && r.BillDateObj < from) return false;
        if (to && r.BillDateObj > to) return false;
        return true;
      });

      if (factoryFilter) {
        data = data.filter(
          r =>
            (r.Factory || "").toLowerCase() ===
            factoryFilter.toLowerCase()
        );
      }
    }

    return data;
  }, [rows, searchBill, fromDate, toDateFilter, factoryFilter]);

  /* 🔥 VIEW LOGIC (ONLY SELECTED BILL SHOWN) */
  const displayRows = selectedBillId
    ? filteredRows.filter(r => r.BillID === selectedBillId)
    : filteredRows;

  return (
    <div style={{ padding: 20 }}>
      <h2>Bill Report</h2>

      {/* ===== FILTER BAR ===== */}
      <div style={{ marginBottom: 15 }}>
        <input
          type="text"
          placeholder="Search factory, bill no, date"
          value={searchBill}
          onChange={e => setSearchBill(e.target.value)}
          style={{ width: 350, marginRight: 10 }}
        />

        <select
          value={factoryFilter}
          onChange={e => setFactoryFilter(e.target.value)}
          style={{ marginRight: 10 }}
        >
          <option value="">Select Factory</option>
          {[...new Set(rows.map(r => r.Factory))].map(f => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>

        From:
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          style={{ marginLeft: 5, marginRight: 10 }}
        />

        To:
        <input
          type="date"
          value={toDateFilter}
          onChange={e => setToDateFilter(e.target.value)}
          style={{ marginLeft: 5 }}
        />
      </div>

      {/* ===== BILL TABLE ===== */}
      <table border="1" width="100%">
        <thead>
          <tr>
            <th>Factory</th>
            <th>Bill Num</th>
            <th>Bill Date</th>
            <th>LR Qty</th>
            <th>Bill Qty</th>
            <th>TAXABLE</th>
            <th>TDS</th>
            <th>GST</th>
            <th>Act. Amt</th>
            <th>Final Price</th>
            <th>Bill Type</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((r, i) => (
            <tr key={i}>
              <td>{r.Factory}</td>
              <td>{r["Bill Num"]}</td>
              <td>{r["Bill Date"]}</td>
              <td>{r["LR Qty"]}</td>
              <td>{r["Bill Qty"]}</td>
              <td>{r.TAXABLE}</td>
              <td>{r.TDS}</td>
              <td>{r.GST}</td>
              <td>{r["Act. Amt"]}</td>
              <td>{r["Final Price"]}</td>
              <td>{r["Bill Type"]}</td>
              <td>
                <button
                  onClick={() =>
                    setSelectedBillId(
                      selectedBillId === r.BillID ? null : r.BillID
                    )
                  }
                >
                  {selectedBillId === r.BillID ? "Back" : "View"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ===== DISPATCH DETAILS ===== */}
      {selectedBillId && dispatchRows[selectedBillId] && (
        <>
          <h3 style={{ marginTop: 20 }}>Dispatch Details</h3>
          <table border="1" width="100%">
            <thead>
              <tr>
                <th>Challan No</th>
                <th>Dispatch Date</th>
                <th>Vehicle No</th>
                <th>LR No</th>
                <th>Quantity</th>
                <th>Unit Price</th>
                <th>Final Price</th>
                <th>Delivery No</th>
              </tr>
            </thead>
            <tbody>
              {dispatchRows[selectedBillId].map((d, i) => (
                <tr key={i}>
                  <td>{d.ChallanNo}</td>
                  <td>{d.DispatchDate}</td>
                  <td>{d.VehicleNo}</td>
                  <td>{d.LRNo}</td>
                  <td>{d.Quantity}</td>
                  <td>{d.UnitPrice}</td>
                  <td>{d.FinalPrice}</td>
                  <td>{d.DeliveryNum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default ShowBill;
