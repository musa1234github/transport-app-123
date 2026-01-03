import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import { collection, getDocs, deleteDoc, doc } from "firebase/firestore";
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
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
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
      const data = snapshot.docs.map(docSnap => {
        const row = { id: docSnap.id, ...docSnap.data() };

        row.DisVid = String(row.DisVid || ""); // ensure string
        if (row.DispatchDate) {
          row.DispatchDate = new Date(
            row.DispatchDate.seconds
              ? row.DispatchDate.seconds * 1000
              : row.DispatchDate
          );
        }

        // Correct FactoryName mapping
        row.FactoryName = factoryMap[row.DisVid] || row.FactoryName || "";
        return row;
      });

      setDispatches(data);
    };

    checkAdmin();
    fetchDispatches();
  }, []);

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

  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    );
  };

  const filteredDispatches = dispatches.filter(d => {
    const matchesSearch = Object.values(d).some(val =>
      val?.toString().toLowerCase().includes(searchTerm.toLowerCase())
    );

    const matchesFactory = filterFactory ? d.DisVid === filterFactory : true;

    const matchesFromDate = fromDate
      ? d.DispatchDate && new Date(d.DispatchDate) >= new Date(fromDate)
      : true;

    const matchesToDate = toDate
      ? d.DispatchDate && new Date(d.DispatchDate) <= new Date(toDate)
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
      const pageIds = paginatedDispatches.map(d => d.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

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

  return (
    <div style={{ padding: 20 }}>
      <h2>Dispatch Data</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
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
        <button onClick={handleDeleteSelected} style={{ marginBottom: 10 }}>
          Delete Selected ({selectedIds.length})
        </button>
      )}

      <table border="1" width="100%">
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
                  {col === "DispatchDate"
                    ? formatShortDate(d[col])
                    : d[col]?.toString()}
                </td>
              ))}

              {isAdmin && (
                <td>
                  <button onClick={() => handleDelete(d.id)}>Delete</button>
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
        <button
          disabled={currentPage === 1}
          onClick={() => setCurrentPage(p => p - 1)}
        >
          Prev
        </button>

        {[...Array(totalPages)].map((_, i) => (
          <button
            key={i}
            onClick={() => setCurrentPage(i + 1)}
            style={{
              margin: "0 3px",
              fontWeight: currentPage === i + 1 ? "bold" : "normal"
            }}
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
