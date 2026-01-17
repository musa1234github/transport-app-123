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

  // Handle select all for current page
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedIds([]);
    } else {
      const pageIds = paginatedVehicles.map(v => v.id);
      setSelectedIds(pageIds);
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

      {/* Dynamic Delete Button - Only shows when records are selected */}
      {selectedIds.length > 0 && (
        <div style={{ 
          marginBottom: 20, 
          padding: 15, 
          backgroundColor: "#fff3cd", 
          borderRadius: 8,
          border: "1px solid #ffeaa7",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 2px 5px rgba(0,0,0,0.1)"
        }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{
              backgroundColor: "#ff6b6b",
              color: "white",
              borderRadius: "50%",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 10,
              fontWeight: "bold"
            }}>
              {selectedIds.length}
            </div>
            <span style={{ fontWeight: "bold", color: "#856404" }}>
              {selectedIds.length} vehicle(s) selected for deletion
            </span>
          </div>
          
          <button 
            onClick={handleDeleteMultiple}
            style={{ 
              backgroundColor: "#dc3545", 
              color: "white", 
              border: "none", 
              padding: "10px 20px", 
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: 8,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.backgroundColor = "#c82333"}
            onMouseOut={(e) => e.target.style.backgroundColor = "#dc3545"}
          >
            🗑️ Delete Selected ({selectedIds.length})
          </button>
        </div>
      )}

      {/* Stats Card */}
      <div style={{ 
        marginBottom: 20, 
        padding: 15, 
        backgroundColor: "#f8f9fa", 
        borderRadius: 8,
        border: "1px solid #dee2e6"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 style={{ margin: 0, color: "#495057" }}>📊 Vehicle Statistics</h4>
            <p style={{ margin: "5px 0 0 0", color: "#6c757d" }}>
              Manage your vehicle database efficiently
            </p>
          </div>
          <div style={{ 
            display: "flex", 
            gap: 15,
            backgroundColor: "white",
            padding: "10px 15px",
            borderRadius: 6,
            border: "1px solid #e9ecef"
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#28a745" }}>
                {totalRecords}
              </div>
              <div style={{ fontSize: "12px", color: "#6c757d" }}>Total Vehicles</div>
            </div>
            <div style={{ width: 1, backgroundColor: "#dee2e6" }}></div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#17a2b8" }}>
                {filteredCount}
              </div>
              <div style={{ fontSize: "12px", color: "#6c757d" }}>Filtered</div>
            </div>
            <div style={{ width: 1, backgroundColor: "#dee2e6" }}></div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "24px", fontWeight: "bold", color: "#ffc107" }}>
                {selectedIds.length}
              </div>
              <div style={{ fontSize: "12px", color: "#6c757d" }}>Selected</div>
            </div>
          </div>
        </div>
      </div>

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
            backgroundColor: "#28a745", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          ➕ Add Vehicle
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
            backgroundColor: "#17a2b8", 
            color: "white", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer"
          }}
        >
          {loading ? "⏳ Uploading..." : "📤 Upload Excel"}
        </button>
      </div>

      {/* Export to Excel */}
      <div style={{ marginBottom: 25 }}>
        <button 
          onClick={handleExportExcel}
          style={{ 
            padding: "8px 16px", 
            backgroundColor: "#ffc107", 
            color: "#212529", 
            border: "none", 
            borderRadius: 4,
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          📥 Export to Excel ({totalRecords} records)
        </button>
      </div>

      {/* Message */}
      {message && (
        <div style={{ 
          padding: 12, 
          backgroundColor: "#d4edda", 
          color: "#155724", 
          borderRadius: 6,
          marginBottom: 15,
          border: "1px solid #c3e6cb"
        }}>
          ✅ {message}
        </div>
      )}

      {/* Search and Record Info */}
      <div style={{ 
        marginBottom: 15, 
        padding: 15, 
        backgroundColor: "#e9ecef", 
        borderRadius: 6,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center"
      }}>
        <div>
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
              border: "1px solid #ced4da"
            }}
          />
        </div>
        
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: "bold", color: "#495057" }}>
            📋 Displaying: <span style={{ color: "#28a745" }}>{filteredCount === 0 ? 0 : startIndex + 1}-{endIndex}</span> of {filteredCount} filtered records
          </div>
          <div style={{ fontSize: "12px", color: "#6c757d", marginTop: 2 }}>
            Page {currentPage} of {totalPages} | Total in database: {totalRecords}
          </div>
        </div>
      </div>

      {/* Vehicle List */}
      <table border="1" width="100%" style={{ borderCollapse: "collapse", marginBottom: 20 }}>
        <thead>
          <tr style={{ backgroundColor: "#343a40", color: "white" }}>
            <th style={{ padding: 12, textAlign: "center", width: "50px" }}>
              <input
                type="checkbox"
                checked={selectAll && paginatedVehicles.length > 0}
                onChange={handleSelectAll}
                disabled={paginatedVehicles.length === 0}
              />
            </th>
            <th style={{ padding: 12 }}>Vehicle No</th>
            <th style={{ padding: 12 }}>Owner Name</th>
            <th style={{ padding: 12, width: "150px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {paginatedVehicles.map((v) => (
            <tr key={v.id} style={{ 
              backgroundColor: selectedIds.includes(v.id) ? "#fff3cd" : "white",
              transition: "background-color 0.2s"
            }}>
              <td style={{ padding: 10, textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(v.id)}
                  onChange={() => handleCheckboxChange(v.id)}
                />
              </td>
              <td style={{ padding: 10, fontWeight: "bold" }}>
                {editingId === v.id ? (
                  <input
                    value={editVehicleNo}
                    onChange={(e) => setEditVehicleNo(e.target.value)}
                    style={{ padding: 6, width: "100%", border: "1px solid #ced4da" }}
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
                    style={{ padding: 6, width: "100%", border: "1px solid #ced4da" }}
                  />
                ) : (
                  v.OwnerName
                )}
              </td>
              <td style={{ padding: 10 }}>
                {editingId === v.id ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button 
                      onClick={handleUpdate}
                      style={{ 
                        padding: "6px 12px", 
                        backgroundColor: "#28a745", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 4,
                        cursor: "pointer",
                        flex: 1
                      }}
                    >
                      💾 Save
                    </button>
                    <button 
                      onClick={handleCancelEdit}
                      style={{ 
                        padding: "6px 12px", 
                        backgroundColor: "#6c757d", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 4,
                        cursor: "pointer",
                        flex: 1
                      }}
                    >
                      ❌ Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button 
                      onClick={() => handleEdit(v)}
                      style={{ 
                        padding: "6px 12px", 
                        backgroundColor: "#007bff", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 4,
                        cursor: "pointer",
                        flex: 1
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button 
                      onClick={() => handleDelete(v.id)}
                      style={{ 
                        padding: "6px 12px", 
                        backgroundColor: "#dc3545", 
                        color: "white", 
                        border: "none", 
                        borderRadius: 4,
                        cursor: "pointer",
                        flex: 1
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
          {paginatedVehicles.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", padding: 40 }}>
                <div style={{ color: "#6c757d" }}>
                  📭 No vehicles found
                  {searchTerm && <div style={{ marginTop: 5 }}>Try a different search term</div>}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ 
          marginTop: 20, 
          display: "flex", 
          justifyContent: "space-between",
          alignItems: "center",
          padding: "15px 0",
          borderTop: "1px solid #dee2e6"
        }}>
          <div style={{ color: "#6c757d", fontSize: "14px" }}>
            Showing {filteredCount === 0 ? 0 : startIndex + 1} to {endIndex} of {filteredCount} entries
          </div>
          
          <div style={{ display: "flex", gap: 5 }}>
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              style={{ 
                padding: "8px 12px", 
                cursor: currentPage === 1 ? "not-allowed" : "pointer",
                backgroundColor: currentPage === 1 ? "#f8f9fa" : "#6c757d",
                color: currentPage === 1 ? "#adb5bd" : "white",
                border: "none",
                borderRadius: 4
              }}
            >
              ← Previous
            </button>
            
            {[...Array(totalPages)].map((_, i) => {
              // Show only first, last, current, and adjacent pages
              if (
                i === 0 || 
                i === totalPages - 1 || 
                (i >= currentPage - 2 && i <= currentPage) ||
                (i <= currentPage + 2 && i >= currentPage)
              ) {
                return (
                  <button
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                    style={{
                      padding: "8px 12px",
                      backgroundColor: currentPage === i + 1 ? "#007bff" : "#f8f9fa",
                      color: currentPage === i + 1 ? "white" : "#495057",
                      border: "1px solid #dee2e6",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: currentPage === i + 1 ? "bold" : "normal",
                    }}
                  >
                    {i + 1}
                  </button>
                );
              } else if (
                i === currentPage - 3 ||
                i === currentPage + 3
              ) {
                return <span key={i} style={{ padding: "8px", color: "#6c757d" }}>...</span>;
              }
              return null;
            })}
            
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              style={{ 
                padding: "8px 12px", 
                cursor: currentPage === totalPages ? "not-allowed" : "pointer",
                backgroundColor: currentPage === totalPages ? "#f8f9fa" : "#6c757d",
                color: currentPage === totalPages ? "#adb5bd" : "white",
                border: "none",
                borderRadius: 4
              }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default VehicleMaster;