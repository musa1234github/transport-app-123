import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  updateDoc, 
  deleteDoc, 
  doc 
} from "firebase/firestore";
import * as XLSX from "xlsx";

const VehicleMaster = () => {
  const [vehicleNo, setVehicleNo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Edit states
  const [editingId, setEditingId] = useState(null);
  const [editVehicleNo, setEditVehicleNo] = useState("");
  const [editOwnerName, setEditOwnerName] = useState("");

  // Selection states
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectAll, setSelectAll] = useState(false);

  // Search and pagination
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  const vehicleRef = collection(db, "VehicleMaster");

  // Fetch vehicles from Firestore
  const fetchVehicles = async () => {
    const snapshot = await getDocs(vehicleRef);
    const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setVehicles(data);
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  // Single entry
  const handleAddVehicle = async () => {
    if (!vehicleNo || !ownerName) {
      alert("Vehicle No and Owner Name required");
      return;
    }

    const vNo = vehicleNo.trim().replace(/\s+/g, " ").toUpperCase();

    const q = query(vehicleRef, where("VehicleNo", "==", vNo));
    const existing = await getDocs(q);

    if (!existing.empty) {
      alert("Vehicle already exists");
      return;
    }

    await addDoc(vehicleRef, {
      VehicleNo: vNo,
      OwnerName: ownerName.trim(),
      CreatedAt: new Date(),
    });

    setVehicleNo("");
    setOwnerName("");
    setMessage("✅ Vehicle added successfully");
    fetchVehicles();
  };

  // Start editing
  const handleEdit = (vehicle) => {
    setEditingId(vehicle.id);
    setEditVehicleNo(vehicle.VehicleNo);
    setEditOwnerName(vehicle.OwnerName);
  };

  // Update vehicle
  const handleUpdate = async () => {
    if (!editVehicleNo || !editOwnerName) {
      alert("Both fields are required");
      return;
    }

    const vNo = editVehicleNo.trim().replace(/\s+/g, " ").toUpperCase();
    
    // Check if another vehicle has the same number
    const q = query(vehicleRef, where("VehicleNo", "==", vNo));
    const existing = await getDocs(q);
    const duplicate = existing.docs.find(doc => doc.id !== editingId);
    
    if (duplicate) {
      alert("Vehicle number already exists");
      return;
    }

    try {
      const vehicleDoc = doc(db, "VehicleMaster", editingId);
      await updateDoc(vehicleDoc, {
        VehicleNo: vNo,
        OwnerName: editOwnerName.trim(),
        UpdatedAt: new Date(),
      });
      
      setMessage("✅ Vehicle updated successfully");
      setEditingId(null);
      fetchVehicles();
    } catch (error) {
      alert("Error updating vehicle");
      console.error(error);
    }
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditVehicleNo("");
    setEditOwnerName("");
  };

  // Delete single vehicle
  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this vehicle?")) return;

    try {
      const vehicleDoc = doc(db, "VehicleMaster", id);
      await deleteDoc(vehicleDoc);
      setMessage("✅ Vehicle deleted successfully");
      fetchVehicles();
      // Remove from selected IDs if it's there
      setSelectedIds(selectedIds.filter(selectedId => selectedId !== id));
    } catch (error) {
      alert("Error deleting vehicle");
      console.error(error);
    }
  };

  // Handle checkbox selection
  const handleCheckboxChange = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) 
        ? prev.filter(item => item !== id)
        : [...prev, id]
    );
  };

  // Handle select all
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedVehicles.map(v => v.id));
    }
    setSelectAll(!selectAll);
  };

  // Delete multiple vehicles
  const handleDeleteMultiple = async () => {
    if (selectedIds.length === 0) {
      alert("Please select vehicles to delete");
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} vehicle(s)?`)) return;

    try {
      const deletePromises = selectedIds.map(id => 
        deleteDoc(doc(db, "VehicleMaster", id))
      );
      await Promise.all(deletePromises);
      
      setMessage(`✅ ${selectedIds.length} vehicle(s) deleted successfully`);
      setSelectedIds([]);
      setSelectAll(false);
      fetchVehicles();
    } catch (error) {
      alert("Error deleting vehicles");
      console.error(error);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    setExcelFile(e.target.files[0]);
    setMessage("");
  };

  // Normalize header keys
  const normalizeKey = (key) => key.toString().trim().toLowerCase().replace(/\s+/g, "");

  // Excel upload
  const handleExcelUpload = async () => {
    if (!excelFile) {
      alert("Please select an Excel file first");
      return;
    }

    setLoading(true);
    setMessage("");

    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        let added = 0;
        let skipped = 0;

        for (let row of rows) {
          const rowKeys = Object.keys(row).reduce((acc, k) => {
            acc[normalizeKey(k)] = row[k];
            return acc;
          }, {});

          const vehicle = rowKeys["truckno"];
          const owner = rowKeys["name"];
          if (!vehicle || !owner) continue;

          const vNo = vehicle.toString().trim().replace(/\s+/g, " ").toUpperCase();
          const oName = owner.toString().trim();

          const q = query(vehicleRef, where("VehicleNo", "==", vNo));
          const existing = await getDocs(q);

          if (existing.empty) {
            await addDoc(vehicleRef, {
              VehicleNo: vNo,
              OwnerName: oName,
              CreatedAt: new Date(),
            });
            added++;
          } else {
            skipped++;
          }
        }

        setMessage(
          `✅ Excel upload completed. Added ${added} vehicles, Skipped ${skipped} duplicates.`
        );

        fetchVehicles();
      } catch (err) {
        console.error("Excel upload error:", err);
        alert("Excel upload failed. Check console.");
      } finally {
        setExcelFile(null);
        setLoading(false);
      }
    };

    reader.readAsArrayBuffer(excelFile);
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (!vehicles.length) return;

    const exportData = vehicles.map(v => ({
      "Vehicle No": v.VehicleNo,
      "Owner Name": v.OwnerName,
      "Created At": v.CreatedAt?.toDate().toLocaleString(),
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VehicleMaster");
    XLSX.writeFile(wb, `VehicleMaster_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Filtered & Paginated vehicles
  const filteredVehicles = vehicles.filter(
    (v) =>
      v.VehicleNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.OwnerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalRecords = vehicles.length;
  const filteredCount = filteredVehicles.length;

  const totalPages = Math.ceil(filteredCount / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, filteredCount);
  const paginatedVehicles = filteredVehicles.slice(startIndex, endIndex);

  return (
    <div style={{ padding: 20 }}>
      <h2>🚚 Vehicle Master</h2>

      {/* Multiple Delete Button */}
      {selectedIds.length > 0 && (
        <div style={{ 
          marginBottom: 15, 
          padding: 10, 
          backgroundColor: "#ffe6e6", 
          borderRadius: 5 
        }}>
          <button 
            onClick={handleDeleteMultiple}
            style={{ 
              backgroundColor: "#ff3333", 
              color: "white", 
              border: "none", 
              padding: "8px 16px", 
              borderRadius: 4,
              cursor: "pointer"
            }}
          >
            🗑️ Delete Selected ({selectedIds.length})
          </button>
          <span style={{ marginLeft: 10 }}>
            {selectedIds.length} vehicle(s) selected
          </span>
        </div>
      )}

      {/* Single Entry */}
      <div style={{ marginBottom: 25, padding: 15, border: "1px solid #ddd", borderRadius: 5 }}>
        <h4>Add New Vehicle</h4>
        <input
          placeholder="Vehicle Number"
          value={vehicleNo}
          onChange={(e) => setVehicleNo(e.target.value)}
          style={{ padding: 8, marginRight: 10 }}
        />
        <input
          placeholder="Owner Name"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          style={{ padding: 8, marginRight: 10 }}
        />
        <button 
          onClick={handleAddVehicle}
          style={{ 
            padding: "8px 16px", 
            backgroundColor: "#4CAF50", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          Add Vehicle
        </button>
      </div>

      {/* Excel Upload */}
      <div style={{ marginBottom: 25, padding: 15, border: "1px solid #ddd", borderRadius: 5 }}>
        <h4>Upload Excel</h4>
        <input type="file" accept=".xlsx,.xls" onChange={handleFileSelect} />
        {excelFile && <p>📄 Selected: <b>{excelFile.name}</b></p>}
        <button
          onClick={handleExcelUpload}
          disabled={loading}
          style={{ 
            marginTop: 10,
            padding: "8px 16px", 
            backgroundColor: "#2196F3", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          {loading ? "Uploading..." : "📤 Upload Excel"}
        </button>
      </div>

      {/* Export to Excel */}
      <div style={{ marginBottom: 25 }}>
        <button 
          onClick={handleExportExcel}
          style={{ 
            padding: "8px 16px", 
            backgroundColor: "#FF9800", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          📥 Export to Excel
        </button>
      </div>

      {/* Message */}
      {message && (
        <div style={{ 
          padding: 10, 
          backgroundColor: "#d4edda", 
          color: "#155724", 
          borderRadius: 4,
          marginBottom: 15
        }}>
          {message}
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 15 }}>
        <input
          placeholder="🔍 Search Vehicle No or Owner Name"
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setCurrentPage(1);
          }}
          style={{ 
            width: 300, 
            padding: 8, 
            borderRadius: 4,
            border: "1px solid #ccc"
          }}
        />
      </div>

      {/* Record count */}
      <div style={{ marginBottom: 10, fontWeight: "bold" }}>
        Showing {filteredCount === 0 ? 0 : startIndex + 1}-{endIndex} of {filteredCount} filtered records
        (Total in DB: {totalRecords})
      </div>

      {/* Vehicle List */}
      <table border="1" width="100%" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ backgroundColor: "#f2f2f2" }}>
            <th style={{ padding: 10 }}>
              <input
                type="checkbox"
                checked={selectAll}
                onChange={handleSelectAll}
              />
            </th>
            <th style={{ padding: 10 }}>Vehicle No</th>
            <th style={{ padding: 10 }}>Owner Name</th>
            <th style={{ padding: 10 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedVehicles.map((v) => (
            <tr key={v.id}>
              <td style={{ padding: 10, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(v.id)}
                  onChange={() => handleCheckboxChange(v.id)}
                />
              </td>
              <td style={{ padding: 10 }}>
                {editingId === v.id ? (
                  <input
                    value={editVehicleNo}
                    onChange={(e) => setEditVehicleNo(e.target.value)}
                    style={{ padding: 5, width: "100%" }}
                  />
                ) : (
                  v.VehicleNo
                )}
              </td>
              <td style={{ padding: 10 }}>
                {editingId === v.id ? (
                  <input
                    value={editOwnerName}
                    onChange={(e) => setEditOwnerName(e.target.value)}
                    style={{ padding: 5, width: "100%" }}
                  />
                ) : (
                  v.OwnerName
                )}
              </td>
              <td style={{ padding: 10 }}>
                {editingId === v.id ? (
                  <>
                    <button 
                      onClick={handleUpdate}
                      style={{ 
                        padding: "5px 10px", 
                        marginRight: 5, 
                        backgroundColor: "#4CAF50", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 3,
                        cursor: "pointer"
                      }}
                    >
                      Save
                    </button>
                    <button 
                      onClick={handleCancelEdit}
                      style={{ 
                        padding: "5px 10px", 
                        backgroundColor: "#f44336", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 3,
                        cursor: "pointer"
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => handleEdit(v)}
                      style={{ 
                        padding: "5px 10px", 
                        marginRight: 5, 
                        backgroundColor: "#2196F3", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 3,
                        cursor: "pointer"
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      onClick={() => handleDelete(v.id)}
                      style={{ 
                        padding: "5px 10px", 
                        backgroundColor: "#f44336", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 3,
                        cursor: "pointer"
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {paginatedVehicles.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", padding: 20 }}>
                No vehicles found
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ marginTop: 20, textAlign: "center" }}>
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
            style={{ 
              padding: "8px 12px", 
              margin: "0 5px", 
              cursor: currentPage === 1 ? "not-allowed" : "pointer",
              backgroundColor: currentPage === 1 ? "#f0f0f0" : "#4CAF50",
              color: currentPage === 1 ? "#999" : "white",
              border: "none",
              borderRadius: 4
            }}
          >
            Previous
          </button>
          
          {[...Array(totalPages)].map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i + 1)}
              style={{
                padding: "8px 12px",
                margin: "0 2px",
                backgroundColor: currentPage === i + 1 ? "#2196F3" : "#f0f0f0",
                color: currentPage === i + 1 ? "white" : "#333",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontWeight: currentPage === i + 1 ? "bold" : "normal",
              }}
            >
              {i + 1}
            </button>
          ))}
          
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
            style={{ 
              padding: "8px 12px", 
              margin: "0 5px", 
              cursor: currentPage === totalPages ? "not-allowed" : "pointer",
              backgroundColor: currentPage === totalPages ? "#f0f0f0" : "#4CAF50",
              color: currentPage === totalPages ? "#999" : "white",
              border: "none",
              borderRadius: 4
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};

export default VehicleMaster;