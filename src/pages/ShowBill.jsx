import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  query,
  where
} from "firebase/firestore";
import * as XLSX from "xlsx";

/* ================= COLUMNS ================= */
const COLUMN_SEQUENCE = [
  "FactoryName",
  "BillNum",
  "BillDate",
  "TotalQty"
];

/* ================= DATE FORMAT ================= */
const formatShortDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${d.getFullYear()}`;
};

const ShowBill = () => {
  const [bills, setBills] = useState([]);
  const [dispatchMap, setDispatchMap] = useState({});
  const [expandedBillIds, setExpandedBillIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const recordsPerPage = 10;

  /* ================= ADMIN CHECK ================= */
  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };
    checkAdmin();
  }, []);

  /* ================= FETCH BILLS & DISPATCHES ================= */
  useEffect(() => {
    const fetchData = async () => {
      const billSnap = await getDocs(collection(db, "BillTable"));
      const dispatchSnap = await getDocs(collection(db, "TblDispatch"));

      const map = {};
      dispatchSnap.docs.forEach(ds => {
        const d = ds.data();
        if (!d.BillID) return;
        if (!map[d.BillID]) map[d.BillID] = [];
        map[d.BillID].push({
          id: ds.id,
          ChallanNo: d.ChallanNo || "",
          DispatchDate: d.DispatchDate ? new Date(d.DispatchDate) : null,
          Qty: d.DispatchQuantity || 0,
          UnitPrice: d.UnitPrice || 0,
          Destination: d.Destination || ""
        });
      });
      setDispatchMap(map);

      const billsData = billSnap.docs.map(bs => {
        const b = bs.data();
        return {
          id: bs.id,
          FactoryName: b.FactoryName || "",
          BillNum: b.BillNum || "",
          BillDate: b.BillDate?.seconds
            ? new Date(b.BillDate.seconds * 1000)
            : b.BillDate
              ? new Date(b.BillDate)
              : null,
          TotalQty: map[bs.id]?.reduce((sum, d) => sum + Number(d.Qty), 0) || 0
        };
      });

      setBills(billsData);
    };

    fetchData();
  }, []);

  /* ================= FILTER ================= */
  const filteredBills = bills.filter(b => {
    const matchesSearch = Object.values(b).some(v =>
      v?.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );

    const matchesFactory = filterFactory
      ? b.FactoryName === filterFactory
      : true;

    const matchesFromDate = fromDate
      ? b.BillDate && b.BillDate >= new Date(fromDate)
      : true;

    const matchesToDate = toDate
      ? b.BillDate && b.BillDate <= new Date(toDate)
      : true;

    return matchesSearch && matchesFactory && matchesFromDate && matchesToDate;
  });

  /* ================= PAGINATION ================= */
  const filteredCount = filteredBills.length;
  const totalPages = Math.ceil(filteredCount / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;

  const paginatedBills = filteredBills.slice(
    startIndex,
    startIndex + recordsPerPage
  );

  /* ================= CHECKBOX ================= */
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : [...prev, id]
    );
  };

  const isAllSelected =
    paginatedBills.length > 0 &&
    paginatedBills.every(b => selectedIds.includes(b.id));

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(prev =>
        prev.filter(id => !paginatedBills.some(b => b.id === id))
      );
    } else {
      setSelectedIds(prev => [
        ...new Set([...prev, ...paginatedBills.map(b => b.id)])
      ]);
    }
  };

  /* ================= DELETE ================= */
  const unlinkDispatches = async (billId) => {
    const q = query(
      collection(db, "TblDispatch"),
      where("BillID", "==", billId)
    );

    const snap = await getDocs(q);
    for (let d of snap.docs) {
      await updateDoc(doc(db, "TblDispatch", d.id), {
        BillID: "",
        UnitPrice: 0,
        FinalPrice: 0
      });
    }
  };

  const handleDelete = async (billId) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this bill?")) return;

    await unlinkDispatches(billId);
    await deleteDoc(doc(db, "BillTable", billId));

    setBills(prev => prev.filter(b => b.id !== billId));
    setSelectedIds(prev => prev.filter(id => id !== billId));
  };

  const handleDeleteSelected = async () => {
    if (!isAdmin || !selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} bills?`)) return;

    for (let id of selectedIds) {
      await unlinkDispatches(id);
      await deleteDoc(doc(db, "BillTable", id));
    }

    setBills(prev => prev.filter(b => !selectedIds.includes(b.id)));
    setSelectedIds([]);
  };

  /* ================= EXCEL ================= */
  const exportToExcel = () => {
    if (!filteredBills.length) return;

    const excelData = filteredBills.map(b => ({
      FactoryName: b.FactoryName,
      BillNum: b.BillNum,
      BillDate: formatShortDate(b.BillDate),
      TotalQty: b.TotalQty
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bills");
    XLSX.writeFile(wb, "Bill_Data.xlsx");
  };

  /* ================= TOGGLE DISPATCH VIEW ================= */
  const toggleExpand = (billId) => {
    setExpandedBillIds(prev =>
      prev.includes(billId)
        ? prev.filter(id => id !== billId)
        : [...prev, billId]
    );
  };

  /* ================= UI ================= */
  return (
    <div style={{ padding: 20 }}>
      <h2>Bill Data</h2>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="Search..."
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
        />

        <select
          value={filterFactory}
          onChange={e => {
            setFilterFactory(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="">All Factories</option>
          <option value="JSW">JSW</option>
          <option value="MANIKGARH">Manikgarh</option>
          <option value="ULTRATECH">Ultratech</option>
          <option value="AMBUJA">Ambuja</option>
          <option value="ACC MARATHA">ACC Maratha</option>
          <option value="DALMIA">Dalmia</option>
          <option value="MP BIRLA">MP Birla</option>
          <option value="ORIENT">Orient</option>
        </select>

        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />

        <button onClick={exportToExcel}>Export Excel</button>
      </div>

      {isAdmin && selectedIds.length > 0 && (
        <button onClick={handleDeleteSelected} style={{ marginTop: 10 }}>
          Delete Selected ({selectedIds.length})
        </button>
      )}

      <table border="1" width="100%" style={{ marginTop: 10, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {isAdmin && (
              <th>
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleSelectAll}
                />
              </th>
            )}
            {COLUMN_SEQUENCE.map(col => (
              <th key={col}>{col}</th>
            ))}
            <th>Action</th>
          </tr>
        </thead>

        <tbody>
          {paginatedBills.map(b => (
            <React.Fragment key={b.id}>
              {/* Master row */}
              <tr style={{ background: "#f9f9f9" }}>
                {isAdmin && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(b.id)}
                      onChange={() => handleCheckboxChange(b.id)}
                    />
                  </td>
                )}
                <td>{b.FactoryName}</td>
                <td>{b.BillNum}</td>
                <td>{formatShortDate(b.BillDate)}</td>
                <td>{b.TotalQty}</td>
                <td>
                  <button onClick={() => handleDelete(b.id)}>Delete</button>{" "}
                  <button onClick={() => toggleExpand(b.id)}>
                    {expandedBillIds.includes(b.id) ? "Hide" : "View"}
                  </button>
                </td>
              </tr>

              {/* Dispatch rows */}
              {expandedBillIds.includes(b.id) &&
                (dispatchMap[b.id] || []).map(ds => (
                  <tr key={ds.id} style={{ background: "#fff" }}>
                    <td colSpan={1}></td>
                    <td>{ds.ChallanNo}</td>
                    <td>{formatShortDate(ds.DispatchDate)}</td>
                    <td>{ds.Qty}</td>
                    <td>{ds.UnitPrice}</td>
                    <td>{ds.Destination}</td>
                  </tr>
                ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ShowBill;
