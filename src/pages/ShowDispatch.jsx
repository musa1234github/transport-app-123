// src/pages/ShowDispatch.jsx
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs, deleteDoc, doc, updateDoc } from "firebase/firestore";

const ShowDispatch = () => {
  const [dispatches, setDispatches] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({ ChallanNo: "", Destination: "", DispatchQuantity: "" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  // Fetch dispatch data
  const fetchDispatches = async () => {
    try {
      const snapshot = await getDocs(collection(db, "TblDispatch"));
      const data = snapshot.docs.map(docSnap => {
        const row = { id: docSnap.id, ...docSnap.data() };
        if (row.DispatchDate) row.DispatchDate = new Date(row.DispatchDate.seconds ? row.DispatchDate.seconds * 1000 : row.DispatchDate);
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

  // Delete a dispatch
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

  // Delete multiple
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
    setEditData({ ChallanNo: d.ChallanNo, Destination: d.Destination, DispatchQuantity: d.DispatchQuantity });
  };

  // Save edits
  const handleSave = async (id) => {
    try {
      await updateDoc(doc(db, "TblDispatch", id), {
        ChallanNo: editData.ChallanNo,
        Destination: editData.Destination,
        DispatchQuantity: Number(editData.DispatchQuantity),
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

  // Filtered dispatches
  const filteredDispatches = dispatches.filter(d =>
    d.ChallanNo?.toString().includes(searchTerm) ||
    d.Destination?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    d.VehicleNo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination
  const totalPages = Math.ceil(filteredDispatches.length / recordsPerPage);
  const paginatedDispatches = filteredDispatches.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  return (
    <div style={{ padding: "20px" }}>
      <h2>Dispatch Data</h2>

      <div style={{ marginBottom: "10px" }}>
        <input
          type="text"
          placeholder="Search by ChallanNo, Destination, VehicleNo..."
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
          style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
        />
      </div>

      {selectedIds.length > 0 && (
        <button onClick={handleDeleteSelected} style={{ marginBottom: "10px", background: "red", color: "#fff", padding: "5px 10px", border: "none", borderRadius: "5px" }}>
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
            <th>ChallanNo</th>
            <th>DispatchDate</th>
            <th>Destination</th>
            <th>DispatchQuantity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedDispatches.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: "center" }}>No data found</td>
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
                <td>
                  {editId === d.id ? (
                    <input
                      value={editData.ChallanNo}
                      onChange={(e) => setEditData({ ...editData, ChallanNo: e.target.value })}
                    />
                  ) : (
                    d.ChallanNo
                  )}
                </td>
                <td>{d.DispatchDate ? new Date(d.DispatchDate).toLocaleDateString() : ""}</td>
                <td>
                  {editId === d.id ? (
                    <input
                      value={editData.Destination}
                      onChange={(e) => setEditData({ ...editData, Destination: e.target.value })}
                    />
                  ) : (
                    d.Destination
                  )}
                </td>
                <td>
                  {editId === d.id ? (
                    <input
                      value={editData.DispatchQuantity}
                      onChange={(e) => setEditData({ ...editData, DispatchQuantity: e.target.value })}
                    />
                  ) : (
                    d.DispatchQuantity
                  )}
                </td>
                <td>
                  {editId === d.id ? (
                    <>
                      <button onClick={() => handleSave(d.id)}>Save</button>{" "}
                      <button onClick={() => setEditId(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => handleEdit(d)}>Edit</button>{" "}
                      <button onClick={() => handleDelete(d.id)}>Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Pagination buttons */}
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
