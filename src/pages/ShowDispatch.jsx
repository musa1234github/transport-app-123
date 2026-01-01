// src/pages/ShowDispatch.jsx
import React, { useEffect, useState } from "react";
import { db, auth } from "../firebaseConfig";
import { collection, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";
import * as XLSX from "xlsx";

const factoryMap = {
  "10": "JSW",
  "6": "Manigar",
  "7": "Ultratech"
};

const ShowDispatch = () => {
  const [dispatches, setDispatches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({
    ChallanNo: "",
    Destination: "",
    DispatchQuantity: "",
    VehicleNo: ""
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterFactory, setFilterFactory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const recordsPerPage = 10;

  // Fetch dispatches
  const fetchDispatches = async () => {
    try {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.map(docSnap => {
        const row = { id: docSnap.id, ...docSnap.data() };
        row.DisVid = String(row.DisVid || "").trim();

        if (row.DispatchDate) {
          row.DispatchDate = new Date(
            row.DispatchDate.seconds ? row.DispatchDate.seconds * 1000 : row.DispatchDate
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

  // Check admin role
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

  // Delete single
  const handleDelete = async (id) => {
    if (!isAdmin) return alert("You do not have permission to delete records!");
    if (!window.confirm("Are you sure you want to delete this record?")) return;

    await deleteDoc(doc(db, "TblDispatch", id));
    setDispatches(dispatches.filter(d => d.id !== id));
    setSelectedIds(selectedIds.filter(sid => sid !== id));
  };

  // Delete multiple
  const handleDeleteSelected = async () => {
    if (!isAdmin) return alert("You do not have permission to delete records!");
    if (!selectedIds.length) return alert("Select records first");
    if (!window.confirm(`Delete ${selectedIds.length} records?`)) return;

    for (let id of selectedIds) {
      await deleteDoc(doc(db, "TblDispatch", id));
    }

    setDispatches(dispatches.filter(d => !selectedIds.includes(d.id)));
    setSelectedIds([]);
  };

  // Edit
  const handleEdit = (d) => {
    if (!isAdmin) return;
    setEditId(d.id);
    setEditData({
      ChallanNo: d.ChallanNo,
      Destination: d.Destination,
      DispatchQuantity: d.DispatchQuantity,
      VehicleNo: d.VehicleNo || ""
    });
  };

  // Save
  const handleSave = async (id) => {
    if (!isAdmin) return;
    await updateDoc(doc(db, "TblDispatch", id), {
      ChallanNo: editData.ChallanNo,
      Destination: editData.Destination,
      DispatchQuantity: Number(editData.DispatchQuantity),
      VehicleNo: editData.VehicleNo
    });

    setDispatches(dispatches.map(d => (d.id === id ? { ...d, ...editData } : d)));
    setEditId(null);
  };

  // Checkbox
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  // Filtering
  const filteredDispatches = dispatches.filter(d => {
    const matchesSearch =
      d.ChallanNo?.toString().includes(searchTerm) ||
      d.Destination?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.VehicleNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.FactoryName?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFactory = filterFactory ? d.DisVid === filterFactory : true;
    const matchesFromDate = fromDate ? new Date(d.DispatchDate) >= new Date(fromDate) : true;
    const matchesToDate = toDate ? new Date(d.DispatchDate) <= new Date(toDate) : true;

    return matchesSearch && matchesFactory && matchesFromDate && matchesToDate;
  });

  // Export to Excel
  const exportToExcel = () => {
    if (!filteredDispatches.length) return alert("No data to export");

    const excelData = filteredDispatches.map(d => ({
      "Challan No": d.ChallanNo,
      "Dispatch Date": d.DispatchDate ? new Date(d.DispatchDate).toLocaleDateString() : "",
      "Destination": d.Destination,
      "Quantity": d.DispatchQuantity,
      "Vehicle No": d.VehicleNo,
      "Factory": d.FactoryName
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Dispatch");

    XLSX.writeFile(
      workbook,
      `Dispatch_Data_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  // Pagination
  const totalPages = Math.ceil(filteredDispatches.length / recordsPerPage);
  const paginatedDispatches = filteredDispatches.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  return (
    <div style={{ padding: "20px" }}>
      <h2>Dispatch Data</h2>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "10px", flexWrap: "wrap" }}>
        <input
          placeholder="Search..."
          value={searchTerm}
          onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
        />

        <select
          value={filterFactory}
          onChange={e => { setFilterFactory(e.target.value); setCurrentPage(1); }}
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

      {/* Delete selected button only for admin */}
      {isAdmin && selectedIds.length > 0 && (
        <button onClick={handleDeleteSelected} style={{ background: "red", color: "#fff", marginBottom: 10 }}>
          Delete Selected ({selectedIds.length})
        </button>
      )}

      <table border="1" width="100%">
        <thead>
          <tr>
            {isAdmin && <th></th>}
            <th>Challan</th>
            <th>Date</th>
            <th>Destination</th>
            <th>Qty</th>
            <th>Vehicle</th>
            <th>Factory</th>
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
              <td>{d.ChallanNo}</td>
              <td>{d.DispatchDate?.toLocaleDateString()}</td>
              <td>{d.Destination}</td>
              <td>{d.DispatchQuantity}</td>
              <td>{d.VehicleNo}</td>
              <td>{d.FactoryName}</td>
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
          You are logged in as a normal user. You cannot edit or delete dispatch records.
        </p>
      )}
    </div>
  );
};

export default ShowDispatch;
