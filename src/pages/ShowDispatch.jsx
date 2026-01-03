import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import { collection, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

const factoryMap = {
  "10": "JSW",
  "6": "Manigar",
  "7": "Ultratech"
};

// 🔹 Helper: short date dd-mm-yyyy
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
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const recordsPerPage = 10;

  // 🔹 Fetch dispatches
  const fetchDispatches = async () => {
    try {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.map(docSnap => {
        const row = { id: docSnap.id, ...docSnap.data() };

        row.DisVid = String(row.DisVid || "").trim();

        if (row.DispatchDate) {
          row.DispatchDate = new Date(
            row.DispatchDate.seconds
              ? row.DispatchDate.seconds * 1000
              : row.DispatchDate
          );
        }

        row.FactoryName = factoryMap[row.DisVid] || row.FactoryName || "";
        return row;
      });

      setDispatches(data);
    } catch (err) {
      console.error("Error fetching dispatch data:", err);
    }
  };

  // 🔹 Check admin
  useEffect(() => {
    const checkAdmin = async () => {
      if (auth.currentUser) {
        const token = await auth.currentUser.getIdTokenResult();
        setIsAdmin(!!token.claims.admin);
      }
    };

    checkAdmin();
    fetchDispatches();
  }, []);

  // 🔹 Delete single
  const handleDelete = async (id) => {
    if (!isAdmin) return alert("No permission");
    if (!window.confirm("Delete this record?")) return;

    await deleteDoc(doc(db, "TblDispatch", id));
    setDispatches(prev => prev.filter(d => d.id !== id));
    setSelectedIds(prev => prev.filter(sid => sid !== id));
  };

  // 🔹 Delete multiple
  const handleDeleteSelected = async () => {
    if (!isAdmin) return alert("No permission");
    if (!selectedIds.length) return alert("Select records first");
    if (!window.confirm(`Delete ${selectedIds.length} records?`)) return;

    for (let id of selectedIds) {
      await deleteDoc(doc(db, "TblDispatch", id));
    }

    setDispatches(prev => prev.filter(d => !selectedIds.includes(d.id)));
    setSelectedIds([]);
  };

  // 🔹 Edit
  const handleEdit = (d) => {
    if (!isAdmin) return;
    setEditId(d.id);
    setEditData({ ...d });
  };

  // 🔹 Save
  const handleSave = async (id) => {
    if (!isAdmin) return;

    const updatePayload = { ...editData };
    delete updatePayload.id;
    delete updatePayload.DisVid; // 🔴 never update DisVid

    await updateDoc(doc(db, "TblDispatch", id), updatePayload);

    setDispatches(prev =>
      prev.map(d => (d.id === id ? { ...d, ...updatePayload } : d))
    );

    setEditId(null);
  };

  // 🔹 Checkbox
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id)
        ? prev.filter(sid => sid !== id)
        : [...prev, id]
    );
  };

  // 🔹 Filtering
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

  // 🔹 Export Excel (exclude created + DisVid)
  const exportToExcel = () => {
    if (!filteredDispatches.length) return alert("No data");

    const excelData = filteredDispatches.map(d => {
      const row = {};
      Object.keys(d).forEach(k => {
        if (
          k !== "id" &&
          k !== "DisVid" &&
          k.toLowerCase() !== "createdon" &&
          k.toLowerCase() !== "created_at"
        ) {
          row[k] = d[k] instanceof Date ? formatShortDate(d[k]) : d[k];
        }
      });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispatch");

    XLSX.writeFile(
      wb,
      `Dispatch_Data_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  // 🔹 Pagination
  const totalPages = Math.ceil(filteredDispatches.length / recordsPerPage);
  const paginatedDispatches = filteredDispatches.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  // 🔹 Collect columns (exclude created + DisVid)
  const columns =
    dispatches.length > 0
      ? Object.keys(dispatches[0]).filter(
          k =>
            k !== "id" &&
            k !== "DisVid" &&
            k.toLowerCase() !== "createdon" &&
            k.toLowerCase() !== "created_at"
        )
      : [];

  return (
    <div style={{ padding: 20 }}>
      <h2>Dispatch Data</h2>

      {/* 🔍 SEARCH + FILTER */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
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

        <button onClick={exportToExcel} style={{ background: "green", color: "#fff" }}>
          Export Excel
        </button>
      </div>

      {isAdmin && selectedIds.length > 0 && (
        <button
          onClick={handleDeleteSelected}
          style={{ background: "red", color: "#fff", marginBottom: 10 }}
        >
          Delete Selected ({selectedIds.length})
        </button>
      )}

      {/* 🔹 TABLE */}
      <table border="1" width="100%">
        <thead>
          <tr>
            {isAdmin && <th></th>}
            {columns.map(col => (
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

              {columns.map(col => (
                <td key={col}>
                  {col === "DispatchDate"
                    ? formatShortDate(d[col])
                    : d[col]?.seconds
                    ? formatShortDate(new Date(d[col].seconds * 1000))
                    : d[col]?.toString()}
                </td>
              ))}

              {isAdmin && (
                <td>
                  <button onClick={() => handleEdit(d)}>Edit</button>{" "}
                  <button onClick={() => handleDelete(d.id)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {!isAdmin && (
        <p style={{ marginTop: 20, color: "red" }}>
          Normal user — edit/delete disabled
        </p>
      )}
    </div>
  );
};

export default ShowDispatch;
