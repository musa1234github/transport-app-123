import React, { useState, useEffect, useCallback } from "react";
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
import "./VehicleMaster.css";

const VehicleMaster = () => {
  const [vehicleNo, setVehicleNo] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [excelFile, setExcelFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);

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

  // Fetch vehicles based on search term
  const fetchVehiclesBySearch = useCallback(async (searchText = "") => {
    try {
      setLoading(true);
      
      if (!searchText.trim()) {
        setVehicles([]);
        setDataLoaded(false);
        setMessage("Please enter a search term to load vehicles");
        return;
      }

      // Create a query that searches both VehicleNo and OwnerName
      const searchLower = searchText.toLowerCase().trim();
      
      // Fetch all vehicles that match the search term in either field
      const q = query(vehicleRef);
      const snapshot = await getDocs(q);
      
      // Filter client-side to match search in both fields
      const allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const filteredData = allData.filter(v => 
        v.VehicleNo.toLowerCase().includes(searchLower) ||
        v.OwnerName.toLowerCase().includes(searchLower)
      );
      
      setVehicles(filteredData);
      setDataLoaded(true);
      setMessage(`✅ Found ${filteredData.length} vehicles matching "${searchText}"`);
      
    } catch (error) {
      console.error("Error fetching vehicles:", error);
      setMessage("❌ Error loading vehicles");
    } finally {
      setLoading(false);
    }
  }, [vehicleRef]);

  // Handle search form submission
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchTerm.trim()) {
      setMessage("Please enter a search term");
      return;
    }
    await fetchVehiclesBySearch(searchTerm);
  };

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
    
    // Refresh search results if data is loaded from a search
    if (dataLoaded && searchTerm) {
      await fetchVehiclesBySearch(searchTerm);
    }
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
      
      // Refresh search results if data is loaded from a search
      if (dataLoaded && searchTerm) {
        await fetchVehiclesBySearch(searchTerm);
      }
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
      
      // Refresh search results if data is loaded from a search
      if (dataLoaded && searchTerm) {
        await fetchVehiclesBySearch(searchTerm);
      }
      
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
      
      // Refresh search results if data is loaded from a search
      if (dataLoaded && searchTerm) {
        await fetchVehiclesBySearch(searchTerm);
      }
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

        setExcelFile(null);
      } catch (err) {
        console.error("Excel upload error:", err);
        alert("Excel upload failed. Check console.");
      } finally {
        setLoading(false);
      }
    };

    reader.readAsArrayBuffer(excelFile);
  };

  // Export to Excel - Only exports currently loaded (searched) data
  const handleExportExcel = () => {
    if (!vehicles.length) {
      alert("No data to export");
      return;
    }

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
    <div className="vehicle-master-container">
      <h2 className="page-title">🚚 Vehicle Master</h2>

      {/* Dynamic Delete Button */}
      {selectedIds.length > 0 && (
        <div className="delete-warning">
          <div className="delete-warning-content">
            <div className="selected-count">
              <div className="count-badge">{selectedIds.length}</div>
              <span className="count-text">
                {selectedIds.length} vehicle(s) selected for deletion
              </span>
            </div>
            
            <button 
              onClick={handleDeleteMultiple}
              className="btn-delete-multiple"
            >
              🗑️ Delete Selected ({selectedIds.length})
            </button>
          </div>
        </div>
      )}

      {/* Search Section */}
      <div className="section-card search-section-card">
        <h4>🔍 Search Vehicles</h4>
        <form onSubmit={handleSearch} className="search-form">
          <div className="search-input-group">
            <input
              type="text"
              placeholder="Enter Vehicle No or Owner Name to search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input-large"
            />
            <button 
              type="submit"
              disabled={loading || !searchTerm.trim()}
              className="btn-search"
            >
              {loading ? "⏳ Searching..." : "🔍 Search"}
            </button>
          </div>
          <p className="search-hint">
            {dataLoaded 
              ? `Found ${vehicles.length} vehicles matching your search`
              : "Enter search terms above to load vehicle data"}
          </p>
        </form>
      </div>

      {/* Stats Card - Only show when data is loaded */}
      {dataLoaded && (
        <div className="stats-card">
          <div className="stats-header">
            <div>
              <h4>📊 Search Results</h4>
              <p>Showing {vehicles.length} vehicles matching "{searchTerm}"</p>
            </div>
            <div className="stats-numbers">
              <div className="stat-item">
                <div className="stat-value total">{vehicles.length}</div>
                <div className="stat-label">Found</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value filtered">{filteredCount}</div>
                <div className="stat-label">Filtered</div>
              </div>
              <div className="stat-divider"></div>
              <div className="stat-item">
                <div className="stat-value selected">{selectedIds.length}</div>
                <div className="stat-label">Selected</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Entry */}
      <div className="section-card">
        <h4>Add New Vehicle</h4>
        <div className="form-row">
          <input
            placeholder="Vehicle Number"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            className="form-input"
          />
          <input
            placeholder="Owner Name"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            className="form-input"
          />
          <button 
            onClick={handleAddVehicle}
            className="btn-add"
          >
            ➕ Add Vehicle
          </button>
        </div>
      </div>

      {/* Excel Upload */}
      <div className="section-card">
        <h4>Upload Excel</h4>
        <input 
          type="file" 
          accept=".xlsx,.xls" 
          onChange={handleFileSelect} 
          className="file-input"
        />
        {excelFile && <p className="file-selected">📄 Selected: <b>{excelFile.name}</b></p>}
        <button
          onClick={handleExcelUpload}
          disabled={loading}
          className="btn-upload"
        >
          {loading ? "⏳ Uploading..." : "📤 Upload Excel"}
        </button>
      </div>

      {/* Export to Excel */}
      {dataLoaded && (
        <div className="section-card">
          <button 
            onClick={handleExportExcel}
            className="btn-export"
          >
            📥 Export Search Results ({vehicles.length} records)
          </button>
          <p className="export-hint">Only exports currently loaded search results</p>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="message-box">
          {message}
        </div>
      )}

      {/* Record Info - Only show when data is loaded */}
      {dataLoaded && (
        <div className="record-info-section">
          <div className="record-info">
            <div className="record-count">
              📋 Displaying: <span>{filteredCount === 0 ? 0 : startIndex + 1}-{endIndex}</span> of {filteredCount} filtered records
            </div>
            <div className="record-details">
              Page {currentPage} of {totalPages} | Total found: {vehicles.length}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle List */}
      {dataLoaded && (
        <div className="table-container">
          <table className="vehicle-table">
            <thead>
              <tr>
                <th className="checkbox-header">
                  <input
                    type="checkbox"
                    checked={selectAll && paginatedVehicles.length > 0}
                    onChange={handleSelectAll}
                    disabled={paginatedVehicles.length === 0}
                  />
                </th>
                <th>Vehicle No</th>
                <th>Owner Name</th>
                <th className="actions-header">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedVehicles.map((v) => (
                <tr 
                  key={v.id}
                  className={selectedIds.includes(v.id) ? "row-selected" : ""}
                >
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(v.id)}
                      onChange={() => handleCheckboxChange(v.id)}
                    />
                  </td>
                  <td>
                    {editingId === v.id ? (
                      <input
                        value={editVehicleNo}
                        onChange={(e) => setEditVehicleNo(e.target.value)}
                        className="edit-input"
                      />
                    ) : (
                      <span className="vehicle-number">{v.VehicleNo}</span>
                    )}
                  </td>
                  <td>
                    {editingId === v.id ? (
                      <input
                        value={editOwnerName}
                        onChange={(e) => setEditOwnerName(e.target.value)}
                        className="edit-input"
                      />
                    ) : (
                      v.OwnerName
                    )}
                  </td>
                  <td className="actions-cell">
                    {editingId === v.id ? (
                      <div className="edit-actions">
                        <button 
                          onClick={handleUpdate}
                          className="btn-save"
                        >
                          💾 Save
                        </button>
                        <button 
                          onClick={handleCancelEdit}
                          className="btn-cancel"
                        >
                          ❌ Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="action-buttons">
                        <button 
                          onClick={() => handleEdit(v)}
                          className="btn-edit"
                        >
                          ✏️ Edit
                        </button>
                        <button 
                          onClick={() => handleDelete(v.id)}
                          className="btn-delete"
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
                  <td colSpan={4} className="no-data">
                    <div>
                      📭 No vehicles found in current search
                      {searchTerm && <div className="no-data-hint">Try a different search term</div>}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {dataLoaded && totalPages > 1 && (
        <div className="pagination-container">
          <div className="pagination-info">
            Showing {filteredCount === 0 ? 0 : startIndex + 1} to {endIndex} of {filteredCount} entries
          </div>
          
          <div className="pagination-controls">
            <button
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className={`pagination-btn ${currentPage === 1 ? 'disabled' : ''}`}
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
                    className={`pagination-number ${currentPage === i + 1 ? 'active' : ''}`}
                  >
                    {i + 1}
                  </button>
                );
              } else if (
                i === currentPage - 3 ||
                i === currentPage + 3
              ) {
                return <span key={i} className="pagination-ellipsis">...</span>;
              }
              return null;
            })}
            
            <button
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className={`pagination-btn ${currentPage === totalPages ? 'disabled' : ''}`}
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