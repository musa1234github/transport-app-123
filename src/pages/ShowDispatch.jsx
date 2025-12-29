// src/pages/ShowDispatch.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";

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
  const recordsPerPage = 10;

  // Fetch and normalize dispatch data
  const fetchDispatches = async () => {
    try {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.map(docSnap => {
        const row = { id: docSnap.id, ...docSnap.data() };

        // Normalize DisVid as string for reliable filtering
        row.DisVid = String(row.DisVid || "").trim();

        // Normalize date
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

  useEffect(() => {
    fetchDispatches();
  }, []);

  // Delete single record
  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this record?")) return;
    try {
      await deleteDoc(doc(db, "TblDispatch", id));
      setDispatches(dispatches.filter(d => d.id !== id));
      setSelectedIds(selectedIds.filter(sid => sid !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // Delete selected records
  const handleDeleteSelected = async () => {
    if (!selectedIds.length) return alert("Select at least one record to delete.");
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} record(s)?`)) return;

    try {
      for (let id of selectedIds) {
        await deleteDoc(doc(db, "TblDispatch", id));
      }
      setDispatches(dispatches.filter(d => !selectedIds.includes(d.id)));
      setSelectedIds([]);
    } catch (err) {
      console.error("Delete multiple failed:", err);
    }
  };

  // Start editing
  const handleEdit = (d) => {
    setEditId(d.id);
    setEditData({
      ChallanNo: d.ChallanNo,
      Destination: d.Destination,
      DispatchQuantity: d.DispatchQuantity,
      VehicleNo: d.VehicleNo || ""
    });
  };

  // Save edits
  const handleSave = async (id) => {
    try {
      await updateDoc(doc(db, "TblDispatch", id), {
        ChallanNo: editData.ChallanNo,
        Destination: editData.Destination,
        DispatchQuantity: Number(editData.DispatchQuantity),
        VehicleNo: editData.VehicleNo
      });
      setDispatches(dispatches.map(d => d.id === id ? { ...d, ...editData } : d));
      setEditId(null);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  // Toggle checkbox
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  // Filter dispatches
  const filteredDispatches = dispatches.filter(d => {
    const matchesSearch = d.ChallanNo?.toString().includes(searchTerm) ||
      d.Destination?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.VehicleNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.FactoryName?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFactory = filterFactory ? d.DisVid === filterFactory : true;
    const matchesFromDate = fromDate ? new Date(d.DispatchDate) >= new Date(fromDate) : true;
    const matchesToDate = toDate ? new Date(d.DispatchDate) <= new Date(toDate) : true;

    return matchesSearch && matchesFactory && matchesFromDate && matchesToDate;
  });

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
          type="text"
          placeholder="Search by Challan, Dest, Vehicle..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          style={{ padding: "8px", flex: 1 }}
        />
        <select
          value={filterFactory}
          onChange={(e) => { setFilterFactory(e.target.value); setCurrentPage(1); }}
          style={{ padding: "8px" }}
        >
          <option value="">All Factories</option>
          <option value="10">JSW</option>
          <option value="6">Manigar</option>
          <option value="7">Ultratech</option>
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); setCurrentPage(1); }}
          style={{ padding: "8px" }}
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => { setToDate(e.target.value); setCurrentPage(1); }}
          style={{ padding: "8px" }}
        />
      </div>

      {selectedIds.length > 0 && (
        <button
          onClick={handleDeleteSelected}
          style={{ marginBottom: "10px", background: "red", color: "#fff", padding: "5px 10px", border: "none", borderRadius: "5px" }}
        >
          Delete Selected ({selectedIds.length})
        </button>
      )}

      <table border="1" cellPadding="5" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                onChange={(e) =>
                  setSelectedIds(e.target.checked ? paginatedDispatches.map(d => d.id) : [])
                }
                checked={paginatedDispatches.every(d => selectedIds.includes(d.id)) && paginatedDispatches.length > 0}
              />
            </th>
            <th>Challan</th>
            <th>Date</th>
            <th>Dest</th>
            <th>Qty</th>
            <th>TruckNo</th>
            <th>Factory</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedDispatches.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: "center" }}>No data found</td>
            </tr>
          ) : (
            paginatedDispatches.map(d => (
              <tr key={d.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(d.id)}
                    onChange={() => handleCheckboxChange(d.id)}
                  />
                </td>
                <td>{editId === d.id ? (
                    <input
                      value={editData.ChallanNo}
                      onChange={(e) => setEditData({ ...editData, ChallanNo: e.target.value })}
                    />
                  ) : d.ChallanNo
                }</td>
                <td>{d.DispatchDate ? new Date(d.DispatchDate).toLocaleDateString() : ""}</td>
                <td>{editId === d.id ? (
                    <input
                      value={editData.Destination}
                      onChange={(e) => setEditData({ ...editData, Destination: e.target.value })}
                    />
                  ) : d.Destination
                }</td>
                <td>{editId === d.id ? (
                    <input
                      value={editData.DispatchQuantity}
                      onChange={(e) => setEditData({ ...editData, DispatchQuantity: e.target.value })}
                    />
                  ) : d.DispatchQuantity
                }</td>
                <td>{editId === d.id ? (
                    <input
                      value={editData.VehicleNo}
                      onChange={(e) => setEditData({ ...editData, VehicleNo: e.target.value })}
                    />
                  ) : d.VehicleNo
                }</td>
                <td>{d.FactoryName}</td>
                <td>{editId === d.id ? (
                  <>
                    <button onClick={() => handleSave(d.id)}>Save</button>{" "}
                    <button onClick={() => setEditId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleEdit(d)}>Edit</button>{" "}
                    <button onClick={() => handleDelete(d.id)}>Delete</button>
                  </>
                )}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ marginTop: "10px" }}>
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i + 1)}
              style={{
                marginRight: "5px",
                background: currentPage === i + 1 ? "blue" : "gray",
                color: "#fff",
                border: "none",
                borderRadius: "3px",
                padding: "3px 6px"
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ShowDispatch;
