import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  doc
} from "firebase/firestore";
import * as XLSX from "xlsx";

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

const ShowBill = () => {
  const [rows, setRows] = useState([]);
  const [dispatchRows, setDispatchRows] = useState({});
  const [selectedBillId, setSelectedBillId] = useState(null);

  /* ===== FILTER STATES ===== */
  const [searchBill, setSearchBill] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");

  const load = async () => {
    const billSnap = await getDocs(collection(db, "BillTable"));
    const dispSnap = await getDocs(collection(db, "TblDispatch"));

    const billMap = {};
    billSnap.docs.forEach(b => {
      billMap[b.id] = b.data();
    });

    const reportMap = {};
    const dispatchMap = {};

    dispSnap.docs.forEach(d => {
      const r = d.data();
      if (!r.BillID || !billMap[r.BillID]) return;

      const bill = billMap[r.BillID];
      const dispatchDate = toDate(r.DispatchDate);
      const billDate = toDate(bill.BillDate);

      if (!dispatchMap[r.BillID]) dispatchMap[r.BillID] = [];

      dispatchMap[r.BillID].push({
        id: d.id,
        ChallanNo: r.ChallanNo || "",
        DispatchDate: dispatchDate
          ? dispatchDate.toLocaleDateString("en-GB")
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
          "Dispatch Month": dispatchDate
            ? dispatchDate.toLocaleString("en-US", { month: "long" })
            : "",
          Factory: bill.FactoryName || r.FactoryName || "",
          "Bill Num": bill.BillNum || "",
          "LR Qty": 0,
          "Bill Qty": 0,
          "TAXABLE": 0,
          "Final Price": 0,
          "Bill Date": billDate
            ? billDate.toLocaleDateString("en-GB")
            : "",
          "Bill Type": bill.BillType || ""
        };
      }

      /* ===== AGGREGATION ===== */
      reportMap[r.BillID]["LR Qty"] += 1;
      reportMap[r.BillID]["Bill Qty"] += toNum(r.DispatchQuantity);

      reportMap[r.BillID]["TAXABLE"] +=
        toNum(r.DispatchQuantity) * toNum(r.UnitPrice);

      reportMap[r.BillID]["Final Price"] += toNum(r.FinalPrice);
    });

    /* ===== FINAL CALCULATION ===== */
    const result = Object.values(reportMap).map(r => {
      const taxable = r["TAXABLE"];
      const finalPrice = r["Final Price"];

      const calculationBase =
        finalPrice > 0 && finalPrice < taxable
          ? finalPrice
          : taxable;

      const gst = calculationBase * 0.18;
      const tds = calculationBase * 0.00984;
      const actAmt = calculationBase + gst;

      /* 🔥 DISPLAY RULE ONLY */
      const displayFinalPrice =
        finalPrice > 0 && Math.abs(finalPrice - taxable) < 0.01
          ? 0
          : finalPrice;

      return {
        ...r,
        "Bill Qty": r["Bill Qty"].toFixed(2),
        "TAXABLE": taxable.toFixed(2),
        "TDS": tds.toFixed(2),
        "GST": gst.toFixed(2),
        "Act. Amt": actAmt.toFixed(2),
        "Final Price": displayFinalPrice.toFixed(2)
      };
    });

    setRows(result);
    setDispatchRows(dispatchMap);
  };

  useEffect(() => {
    load();
  }, []);

  /* ===== DELETE BILL ===== */
  const deleteBill = async (billId, billNum) => {
    if (!window.confirm(`Delete bill ${billNum} ?`)) return;

    if (dispatchRows[billId]) {
      for (const d of dispatchRows[billId]) {
        await updateDoc(doc(db, "TblDispatch", d.id), {
          BillID: null,
          BillNum: null
        });
      }
    }

    await deleteDoc(doc(db, "BillTable", billId));
    alert("Bill deleted successfully");
    setSelectedBillId(null);
    load();
  };

  /* ===== APPLY FILTERS ===== */
  let filteredRows = rows;

  if (searchBill) {
    filteredRows = filteredRows.filter(r =>
      r["Bill Num"].toLowerCase().includes(searchBill.toLowerCase())
    );
  }

  if (factoryFilter) {
    filteredRows = filteredRows.filter(r => r.Factory === factoryFilter);
  }

  if (fromDate) {
    filteredRows = filteredRows.filter(r => {
      const d = new Date(r["Bill Date"].split("/").reverse().join("-"));
      return d >= new Date(fromDate);
    });
  }

  if (toDateFilter) {
    filteredRows = filteredRows.filter(r => {
      const d = new Date(r["Bill Date"].split("/").reverse().join("-"));
      return d <= new Date(toDateFilter);
    });
  }

  const visibleBills = selectedBillId
    ? filteredRows.filter(r => r.BillID === selectedBillId)
    : filteredRows;

  return (
    <div style={{ padding: 20 }}>
      <h2>Bill Report</h2>

      <table border="1" width="100%">
        <thead>
          <tr>
            <th>Dispatch Month</th>
            <th>Factory</th>
            <th>Bill Num</th>
            <th>LR Qty</th>
            <th>Bill Qty</th>
            <th>TAXABLE</th>
            <th>TDS</th>
            <th>GST</th>
            <th>Act. Amt</th>
            <th>Final Price</th>
            <th>Bill Date</th>
            <th>Bill Type</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {visibleBills.map((r, i) => (
            <tr key={i}>
              <td>{r["Dispatch Month"]}</td>
              <td>{r.Factory}</td>
              <td>{r["Bill Num"]}</td>
              <td>{r["LR Qty"]}</td>
              <td>{r["Bill Qty"]}</td>
              <td>{r["TAXABLE"]}</td>
              <td>{r["TDS"]}</td>
              <td>{r["GST"]}</td>
              <td>{r["Act. Amt"]}</td>
              <td>{r["Final Price"]}</td>
              <td>{r["Bill Date"]}</td>
              <td>{r["Bill Type"]}</td>
              <td>
                <button onClick={() => setSelectedBillId(r.BillID)}>View</button>{" "}
                <button
                  style={{ color: "red" }}
                  onClick={() => deleteBill(r.BillID, r["Bill Num"])}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
