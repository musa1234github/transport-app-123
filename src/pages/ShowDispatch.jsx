import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import {
  collection,
  getDocs,
  deleteDoc,
  doc,
  updateDoc
} from "firebase/firestore";
import * as XLSX from "xlsx";

const factoryMap = {
  "10": "JSW",
  "6": "Manigar",
  "7": "Ultratech"
};

const COLUMN_SEQUENCE = [
  "ChallanNo",
  "Destination",
  "VehicleNo",
  "DispatchDate",
  "DispatchQuantity",
  "PartyName",
  "Advance",
  "Diesel",
  "FactoryName"
];

const formatShortDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, "0")}-${String(
    d.getMonth() + 1
  ).padStart(2, "0")}-${d.getFullYear()}`;
};

const ShowDispatch = () => {
  const [dispatches, setDispatches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const [editId, setEditId] = useState(null);
  const [editChallan, setEditChallan] = useState("");

  const recordsPerPage = 10;

  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };

    const fetchDispatches = async () => {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.map(ds => {
        const row = { id: ds.id, ...ds.data() };

        row.DisVid = String(row.DisVid || "");

        if (row.DispatchDate) {
          row.DispatchDate = new Date(
            row.DispatchDate.seconds
              ? row.DispatchDate.seconds * 1000
              : row.DispatchDate
          );
        }

        row.FactoryName = row.FactoryName || factoryMap[row.DisVid] || "";

        return row;
      });

      setDispatches(data);
    };

    checkAdmin();
    fetchDispatches();
  }, []);

  /* ================= EDIT ================= */

  const handleEdit = (row) => {
    setEditId(row.id);
    setEditChallan(row.ChallanNo || "");
  };

  const handleSave = async (id) => {
    await updateDoc(doc(db, "TblDispatch", id), {
      ChallanNo: editChallan
    });

    setDispatches(prev =>
      prev.map(d =>
        d.id === id ? { ...d, ChallanNo: editChallan } : d
      )
    );

    setEditId(null);
    setEditChallan("");
  };

  const handleCancel = () => {
    setEditId(null);
    setEditChallan("");
  };

  /* ================= DELETE ================= */

  const handleDelete = async (id) => {
    if (!isAdmin) return;
    if (!window.confirm("Delete this record?")) return;

    await deleteDoc(doc(db, "TblDispatch", id));
    setDispatches(prev => prev.filter(d => d.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
  };

  const handleDeleteSelected = async () => {
    if (!isAdmin || !selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} records?`)) return;

    for (let id of selectedIds) {
      await deleteDoc(doc(db, "TblDispatch", id));
    }

    setDispatches(prev => prev.filter(d => !selectedIds.includes(d.id)));
    setSelectedIds([]);
  };

  /* ================= CHECKBOX ================= */

  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    );
  };

  /* ================= FILTER (ONLY SEARCH LOGIC CHANGED) ================= */

  const filteredDispatches = dispatches.filter(d => {
    const terms = searchTerm
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const matchesSearch = terms.every(term =>
      Object.values(d).some(v => {
        if (!v) return false;

        if (v instanceof Date) {
          return formatShortDate(v).toLowerCase().includes(term);
        }

        return v.toString().toLowerCase().includes(term);
      })
    );

    const matchesFactory = filterFactory ? d.DisVid === filterFactory : true;

    const matchesFromDate = fromDate
      ? d.DispatchDate && d.DispatchDate >= new Date(fromDate)
      : true;

    const matchesToDate = toDate
      ? d.DispatchDate && d.DispatchDate <= new Date(toDate)
      : true;

    return matchesSearch && matchesFactory && matchesFromDate && matchesToDate;
  });

  const totalRecords = dispatches.length;
  const filteredCount = filteredDispatches.length;
  const totalPages = Math.ceil(filteredCount / recordsPerPage);

  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);

  const paginatedDispatches = filteredDispatches.slice(
    startIndex,
    startIndex + recordsPerPage
  );

  const isAllSelected =
    paginatedDispatches.length > 0 &&
    paginatedDispatches.every(d => selectedIds.includes(d.id));

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(prev =>
        prev.filter(id => !paginatedDispatches.some(d => d.id === id))
      );
    } else {
      setSelectedIds(prev => [
        ...new Set([...prev, ...paginatedDispatches.map(d => d.id)])
      ]);
    }
  };

  /* ================= EXCEL ================= */

  const exportToExcel = () => {
    if (!filteredDispatches.length) return;

    const excelData = filteredDispatches.map(d => {
      const row = {};
      COLUMN_SEQUENCE.forEach(k => {
        row[k] = d[k] instanceof Date ? formatShortDate(d[k]) : d[k];
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispatch");
    XLSX.writeFile(wb, "Dispatch_Data.xlsx");
  };

  /* ================= UI ================= */

  return (
    <div style={{ padding: 20 }}>
      <h2>Dispatch Data</h2>

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
          <option value="10">JSW</option>
          <option value="6">Manigar</option>
          <option value="7">Ultratech</option>
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

      <table border="1" width="100%" style={{ marginTop: 10 }}>
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
            {isAdmin && <th>Action</th>}
          </tr>
        </thead>

        <tbody>
          {paginatedDispatches.map(d => (
            <tr key={d.id}>
              {isAdmin && (
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(d.id)}
                    onChange={() => handleCheckboxChange(d.id)}
                  />
                </td>
              )}

              {COLUMN_SEQUENCE.map(col => (
                <td key={col}>
                  {col === "ChallanNo" && editId === d.id ? (
                    <input
                      value={editChallan}
                      onChange={e => setEditChallan(e.target.value)}
                    />
                  ) : col === "DispatchDate" ? (
                    formatShortDate(d[col])
                  ) : (
                    d[col]
                  )}
                </td>
              ))}

              {isAdmin && (
                <td>
                  {editId === d.id ? (
                    <>
                      <button onClick={() => handleSave(d.id)}>Save</button>
                      <button onClick={handleCancel}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(d)}>Edit</button>
                      <button onClick={() => handleDelete(d.id)}>Delete</button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10, fontWeight: "bold" }}>
        Showing {filteredCount === 0 ? 0 : startIndex + 1}–{endIndex} of{" "}
        {filteredCount} filtered records (Total in DB: {totalRecords})
      </div>

      <div style={{ marginTop: 10 }}>
        <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
          Prev
        </button>

        {[...Array(totalPages)].map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentPage(i + 1)}
            style={{ fontWeight: currentPage === i + 1 ? "bold" : "normal" }}
          >
            {i + 1}
          </button>
        ))}

        <button
          disabled={currentPage === totalPages}
          onClick={() => setCurrentPage(p => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default ShowDispatch;
