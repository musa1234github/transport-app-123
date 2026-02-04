import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import "./ShowDayQty.css";

const ShowDayQty = () => {
  const [dailyData, setDailyData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingFactories, setLoadingFactories] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedFactory, setSelectedFactory] = useState("");
  const [allFactories, setAllFactories] = useState([]);
  const [error, setError] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch only factory names on component mount
  useEffect(() => {
    const fetchFactoryNames = async () => {
      try {
        setLoadingFactories(true);
        // Try to fetch factory names with optimized query
        const factoryQuery = query(
          collection(db, "TblDispatch"),
          limit(100) // Only fetch first 100 documents for factory names
        );
        
        const dispatchSnapshot = await getDocs(factoryQuery);

        if (dispatchSnapshot.empty) {
          setAllFactories([]);
          return;
        }

        const factoryNamesSet = new Set();

        dispatchSnapshot.docs.forEach(doc => {
          const data = doc.data();
          let factoryName = "Unknown";

          // Check various possible factory name fields
          if (data.FactoryName) {
            factoryName = data.FactoryName;
          } else if (data.Factory) {
            factoryName = data.Factory;
          } else if (data.DisVid === "10") {
            factoryName = "JSW";
          } else if (data.DisVid === "6") {
            factoryName = "Manigar";
          } else if (data.DisVid === "7") {
            factoryName = "Ultratech";
          } else if (data.DisVid) {
            factoryName = `Factory ${data.DisVid}`;
          }

          if (factoryName !== "Unknown") {
            factoryNamesSet.add(factoryName);
          }
        });

        const sortedFactories = Array.from(factoryNamesSet).sort();
        setAllFactories(sortedFactories);
        console.log("Loaded factories:", sortedFactories.length, "factories");

      } catch (error) {
        console.error("Error fetching factory names:", error);
        setError(`Failed to load factory list: ${error.message}`);
      } finally {
        setLoadingFactories(false);
      }
    };

    fetchFactoryNames();
  }, []);

  const parseDate = (dateValue) => {
    if (!dateValue) return null;

    try {
      if (dateValue.seconds) {
        return new Date(dateValue.seconds * 1000);
      }

      if (dateValue instanceof Date) {
        return dateValue;
      }

      if (typeof dateValue === 'string') {
        const dateStr = dateValue.split('T')[0];
        return new Date(dateStr);
      }

      return null;
    } catch (err) {
      console.error("Error parsing date:", dateValue, err);
      return null;
    }
  };

  const parseDateString = (dateStr) => {
    if (!dateStr.trim()) return { startDate: null, endDate: null, isValid: false };
    
    try {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        
        if (isNaN(day) || isNaN(month) || isNaN(year)) {
          return { startDate: null, endDate: null, isValid: false };
        }
        
        // Create date at start of day
        const startDate = new Date(year, month, day, 0, 0, 0);
        
        // Create date at end of day
        const endDate = new Date(year, month, day + 1, 0, 0, 0);
        
        return { 
          startDate: startDate, 
          endDate: endDate, 
          startTimestamp: Math.floor(startDate.getTime() / 1000),
          endTimestamp: Math.floor(endDate.getTime() / 1000),
          isValid: true 
        };
      }
    } catch (err) {
      console.error("Error parsing date string:", err);
    }
    return { startDate: null, endDate: null, isValid: false };
  };

  const fetchData = async () => {
    if (!selectedDate && !selectedFactory) {
      setError("Please select at least a factory or date to filter");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);

      console.log("Fetching data with filters:", { selectedDate, selectedFactory });

      // Build query dynamically based on selected filters
      let firestoreQuery;
      let queryConditions = [];
      
      // Option 1: If date is selected, use Firestore query with date filter
      if (selectedDate.trim()) {
        const { startTimestamp, endTimestamp, isValid } = parseDateString(selectedDate);
        
        if (!isValid) {
          setError("Invalid date format. Please use DD/MM/YYYY");
          setLoading(false);
          return;
        }
        
        console.log("Using timestamp query for date:", { startTimestamp, endTimestamp });
        
        // Try query with Timestamp first
        try {
          firestoreQuery = query(
            collection(db, "TblDispatch"),
            where("DispatchDate", ">=", startTimestamp),
            where("DispatchDate", "<", endTimestamp),
            orderBy("DispatchDate")
          );
        } catch (queryError) {
          console.log("Timestamp query failed, trying date object query");
          
          // Fallback to Date object query
          const { startDate, endDate } = parseDateString(selectedDate);
          firestoreQuery = query(
            collection(db, "TblDispatch"),
            where("DispatchDate", ">=", startDate),
            where("DispatchDate", "<", endDate),
            orderBy("DispatchDate")
          );
        }
      } 
      // Option 2: If no date but factory is selected, fetch limited recent data
      else if (selectedFactory) {
        // Fetch only recent data for performance
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        firestoreQuery = query(
          collection(db, "TblDispatch"),
          where("DispatchDate", ">=", thirtyDaysAgo),
          orderBy("DispatchDate", "desc"),
          limit(1000)
        );
      }
      // Option 3: Default fallback (shouldn't reach here due to validation)
      else {
        firestoreQuery = query(
          collection(db, "TblDispatch"),
          orderBy("DispatchDate", "desc"),
          limit(500)
        );
      }

      console.log("Executing Firestore query...");
      const dispatchSnapshot = await getDocs(firestoreQuery);
      console.log(`Fetched ${dispatchSnapshot.size} documents with filters`);

      if (dispatchSnapshot.empty) {
        setError("No matching dispatch records found.");
        setFilteredData([]);
        setLoading(false);
        return;
      }

      const groupedData = {};

      dispatchSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const dispatchDate = parseDate(data.DispatchDate);

        if (!dispatchDate || isNaN(dispatchDate.getTime())) {
          return;
        }

        let factoryName = "Unknown";
        if (data.FactoryName) {
          factoryName = data.FactoryName;
        } else if (data.Factory) {
          factoryName = data.Factory;
        } else if (data.DisVid === "10") {
          factoryName = "JSW";
        } else if (data.DisVid === "6") {
          factoryName = "Manigar";
        } else if (data.DisVid === "7") {
          factoryName = "Ultratech";
        } else if (data.DisVid) {
          factoryName = `Factory ${data.DisVid}`;
        }

        // Apply factory filter at application level if selected
        if (selectedFactory && selectedFactory !== factoryName && selectedFactory !== "") {
          return;
        }

        const dispatchQuantity = parseFloat(data.DispatchQuantity) || 0;
        const unitPrice = parseFloat(data.UnitPrice) || parseFloat(data.Rate) || 0;
        const isBilled = unitPrice > 0 ||
          data.BillStatus === true ||
          data.IsBilled === true ||
          data.Billed === true;

        const dateKey = `${factoryName}_${dispatchDate.toISOString().split('T')[0]}`;

        if (!groupedData[dateKey]) {
          groupedData[dateKey] = {
            Factory: factoryName,
            Date: dispatchDate,
            FormattedDate: `${String(dispatchDate.getDate()).padStart(2, '0')}/${String(dispatchDate.getMonth() + 1).padStart(2, '0')}/${dispatchDate.getFullYear()}`,
            totalQty: 0,
            BillQty: 0,
            Balance: 0
          };
        }

        groupedData[dateKey].totalQty += dispatchQuantity;
        if (isBilled) {
          groupedData[dateKey].BillQty += dispatchQuantity;
        }
      });

      const resultArray = Object.values(groupedData).map(item => {
        item.Balance = item.totalQty - item.BillQty;
        return item;
      });

      resultArray.sort((a, b) => {
        if (a.Factory === b.Factory) {
          return b.Date - a.Date; // Most recent first
        }
        return a.Factory.localeCompare(b.Factory);
      });

      setDailyData(resultArray);
      setFilteredData(resultArray);

    } catch (error) {
      console.error("Error fetching data:", error);
      
      // Handle specific errors
      if (error.code === 'failed-precondition') {
        setError("Database index is being created. Please try again in a moment or contact administrator.");
      } else if (error.code === 'permission-denied') {
        setError("Permission denied. Please check your Firebase rules.");
      } else {
        setError(`Failed to fetch data: ${error.message}`);
      }
      
      // Clear data on error
      setFilteredData([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    // Clear existing data and fetch fresh with filters
    setDailyData([]);
    setFilteredData([]);
    fetchData();
  };

  const handleClear = () => {
    setSelectedDate("");
    setSelectedFactory("");
    setFilteredData([]);
    setDailyData([]);
    setHasSearched(false);
    setError(null);
  };

  const handleTodayDate = () => {
    const today = new Date();
    const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    setSelectedDate(todayStr);
  };

  const calculateTotals = () => {
    return filteredData.reduce((totals, item) => {
      totals.totalQty += item.totalQty;
      totals.BillQty += item.BillQty;
      totals.Balance += item.Balance;
      return totals;
    }, { totalQty: 0, BillQty: 0, Balance: 0 });
  };

  // Handle Enter key press for search
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <h3>Loading data...</h3>
        <div className="loading-spinner"></div>
        <p>Fetching data with optimized query...</p>
      </div>
    );
  }

  const totals = filteredData.length > 0 ? calculateTotals() : null;

  return (
    <div className="container">
      <h1 className="title">Daily Quantity Report</h1>

      {/* Debug Info */}
      <div className="debug-panel">
        <div className="debug-content">
          <div>
            <strong>Optimized Query Active:</strong> Using Firestore filters to reduce reads
          </div>
          <div style={{ fontSize: '12px', color: '#2c3e50' }}>
            {selectedDate && `Date filter: ${selectedDate}`}
            {selectedFactory && selectedDate && ' | '}
            {selectedFactory && `Factory filter: ${selectedFactory}`}
          </div>
        </div>
      </div>

      {/* Controls Section */}
      <div className="controls">
        <div className="controls-row">
          <div className="form-group">
            <label className="form-label">Select Factory:</label>
            {loadingFactories ? (
              <div className="form-input disabled" style={{ color: '#666', fontStyle: 'italic' }}>
                Loading factories...
              </div>
            ) : (
              <select
                value={selectedFactory}
                onChange={(e) => setSelectedFactory(e.target.value)}
                className="form-select"
              >
                <option value="">All Factories</option>
                {allFactories.map((factory, index) => (
                  <option key={index} value={factory}>
                    {factory}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Enter Date (DD/MM/YYYY):</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="DD/MM/YYYY"
                className="form-input"
                style={{ flex: 1 }}
              />
              <button
                onClick={handleTodayDate}
                className="button button-secondary"
                style={{ padding: '10px 15px', whiteSpace: 'nowrap' }}
              >
                Today
              </button>
            </div>
            <small style={{ color: '#666', marginTop: '5px', display: 'block' }}>
              Tip: Select a date for the most efficient query (reduces Firestore reads)
            </small>
          </div>
        </div>

        <div className="controls-buttons">
          <button
            onClick={handleSearch}
            className={`button button-primary ${(!selectedDate && !selectedFactory) || loadingFactories ? 'disabled' : ''}`}
            disabled={(!selectedDate && !selectedFactory) || loadingFactories}
          >
            Search
          </button>

          <button
            onClick={handleClear}
            className="button button-secondary"
          >
            Clear All
          </button>
        </div>
        
        {/* Query Info */}
        <div style={{ 
          marginTop: '15px', 
          fontSize: '12px', 
          color: '#666', 
          textAlign: 'center',
          padding: '8px',
          backgroundColor: '#e8f4f8',
          borderRadius: '4px'
        }}>
          {hasSearched && filteredData.length > 0 ? (
            <span>
              <strong>✓ Query Successful:</strong> Loaded {filteredData.length} daily records 
              {selectedDate && ` for ${selectedDate}`}
              {selectedFactory && ` from ${selectedFactory}`}
            </span>
          ) : hasSearched ? (
            <span>No records found with current filters</span>
          ) : (
            <span>Select filters and click Search to begin</span>
          )}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-container">
          <h3 className="error-title">Error</h3>
          <p>{error}</p>
          <button
            onClick={() => setError(null)}
            className="retry-button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* No factories message */}
      {!loadingFactories && allFactories.length === 0 && !error && (
        <div className="no-data">
          <h3 className="no-data-title">No factories found</h3>
          <p className="no-data-text">No factory data available in the database.</p>
        </div>
      )}

      {/* Results Section */}
      {hasSearched && filteredData.length === 0 && !error && allFactories.length > 0 && (
        <div className="no-data">
          <h3 className="no-data-title">No matching records found</h3>
          <p className="no-data-text">
            {selectedDate && `No records found for date: ${selectedDate}`}
            {selectedFactory && selectedDate && ' and '}
            {selectedFactory && !selectedDate && `No records found for factory: ${selectedFactory}`}
            {!selectedDate && !selectedFactory && 'No records found with current filters'}
          </p>
          <p style={{ marginTop: '10px' }}>
            <button 
              onClick={handleClear}
              className="button button-secondary"
              style={{ padding: '8px 16px' }}
            >
              Clear Filters
            </button>
          </p>
        </div>
      )}

      {/* Data Table */}
      {filteredData.length > 0 && (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr className="table-header">
                  <th style={{ width: '25%' }}>Factory</th>
                  <th style={{ width: '20%' }}>Date</th>
                  <th style={{ width: '18%' }} className="text-right">Total Quantity</th>
                  <th style={{ width: '18%' }} className="text-right">Bill Quantity</th>
                  <th style={{ width: '19%' }} className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, index) => (
                  <tr 
                    key={`${item.Factory}_${item.FormattedDate}_${index}`} 
                    className="table-body"
                    style={{ 
                      backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9f9f9',
                      borderBottom: '1px solid #eee'
                    }}
                  >
                    <td style={{ fontWeight: '600' }}>{item.Factory}</td>
                    <td>{item.FormattedDate}</td>
                    <td className="text-right">{Math.round(item.totalQty * 100) / 100}</td>
                    <td className="text-right">{Math.round(item.BillQty * 100) / 100}</td>
                    <td className="text-right" style={{ 
                      fontWeight: 'bold',
                      color: item.Balance >= 0 ? '#28a745' : '#dc3545'
                    }}>
                      {Math.round(item.Balance * 100) / 100}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          {totals && (
            <div className="summary">
              <h3>Summary</h3>
              <div className="summary-stats">
                <div style={{ 
                  backgroundColor: '#e7f3ff', 
                  padding: '10px', 
                  borderRadius: '6px',
                  flex: 1
                }}>
                  <strong style={{ color: '#007bff' }}>Total Dispatch:</strong>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', marginTop: '5px' }}>
                    {Math.round(totals.totalQty * 100) / 100}
                  </div>
                </div>
                <div style={{ 
                  backgroundColor: '#e7f8e6', 
                  padding: '10px', 
                  borderRadius: '6px',
                  flex: 1
                }}>
                  <strong style={{ color: '#28a745' }}>Total Billed:</strong>
                  <div style={{ fontSize: '20px', fontWeight: 'bold', marginTop: '5px' }}>
                    {Math.round(totals.BillQty * 100) / 100}
                  </div>
                </div>
                <div style={{ 
                  backgroundColor: totals.Balance >= 0 ? '#e6f7f9' : '#fde8e8', 
                  padding: '10px', 
                  borderRadius: '6px',
                  flex: 1
                }}>
                  <strong style={{ color: totals.Balance >= 0 ? '#17a2b8' : '#dc3545' }}>Balance:</strong>
                  <div style={{ 
                    fontSize: '20px', 
                    fontWeight: 'bold', 
                    marginTop: '5px',
                    color: totals.Balance >= 0 ? '#17a2b8' : '#dc3545'
                  }}>
                    {Math.round(totals.Balance * 100) / 100}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ShowDayQty;