import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

const ShowDayQty = () => {
  const [dailyData, setDailyData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedFactory, setSelectedFactory] = useState("");
  const [allFactories, setAllFactories] = useState([]);
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState([]); // Store raw data for debugging

  // Debug function to see what's happening
  const logDebugInfo = () => {
    console.log("=== DEBUG INFO ===");
    console.log("Loading:", loading);
    console.log("Error:", error);
    console.log("All factories:", allFactories);
    console.log("Raw data count:", rawData.length);
    console.log("Raw data sample:", rawData.slice(0, 3));
    console.log("Daily data count:", dailyData.length);
    console.log("Daily data sample:", dailyData.slice(0, 3));
    console.log("Filtered data count:", filteredData.length);
    console.log("Selected date:", selectedDate);
    console.log("Selected factory:", selectedFactory);
    console.log("===================");
  };

  // Simple date parsing function
  const parseDate = (dateValue) => {
    if (!dateValue) return null;
    
    try {
      // If it's a Firebase timestamp
      if (dateValue.seconds) {
        return new Date(dateValue.seconds * 1000);
      }
      
      // If it's already a Date object
      if (dateValue instanceof Date) {
        return dateValue;
      }
      
      // If it's a string, try to parse it
      if (typeof dateValue === 'string') {
        // Remove any time portion if present
        const dateStr = dateValue.split('T')[0];
        return new Date(dateStr);
      }
      
      return null;
    } catch (err) {
      console.error("Error parsing date:", dateValue, err);
      return null;
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        console.log("Starting data fetch...");
        
        const dispatchSnapshot = await getDocs(collection(db, "TblDispatch"));
        
        console.log("Firebase query result:", {
          size: dispatchSnapshot.size,
          empty: dispatchSnapshot.empty
        });
        
        if (dispatchSnapshot.empty) {
          console.log("No documents found in TblDispatch collection");
          setError("No dispatch records found in the database.");
          return;
        }
        
        const factoryNamesSet = new Set();
        const rawDataArray = [];
        
        dispatchSnapshot.docs.forEach((doc, index) => {
          const data = doc.data();
          rawDataArray.push(data);
          
          console.log(`Document ${index}:`, {
            id: doc.id,
            data: data,
            hasDispatchDate: !!data.DispatchDate,
            hasFactoryName: !!data.FactoryName,
            hasDisVid: !!data.DisVid
          });
          
          // Get factory name
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
          
          if (factoryName !== "Unknown") {
            factoryNamesSet.add(factoryName);
          }
        });
        
        setRawData(rawDataArray);
        
        const factoryNamesArray = Array.from(factoryNamesSet).sort();
        console.log("Unique factories found:", factoryNamesArray);
        setAllFactories(factoryNamesArray);
        
        // Process data for display
        processDisplayData(dispatchSnapshot.docs);
        
      } catch (error) {
        console.error("Error fetching data:", error);
        setError(`Failed to fetch data: ${error.message}`);
      } finally {
        setLoading(false);
        logDebugInfo();
      }
    };

    fetchData();
  }, []);

  const processDisplayData = (docs) => {
    const groupedData = {};
    
    docs.forEach(doc => {
      const data = doc.data();
      const dispatchDate = parseDate(data.DispatchDate);
      
      if (!dispatchDate || isNaN(dispatchDate.getTime())) {
        console.log("Skipping document with invalid date:", doc.id, data);
        return;
      }
      
      // Get factory name
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
      
      const dispatchQuantity = parseFloat(data.DispatchQuantity) || 0;
      const unitPrice = parseFloat(data.UnitPrice) || parseFloat(data.Rate) || 0;
      const isBilled = unitPrice > 0 || 
                      data.BillStatus === true || 
                      data.IsBilled === true ||
                      data.Billed === true;
      
      // Create a unique key for grouping
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
    
    // Convert to array and calculate balances
    const resultArray = Object.values(groupedData).map(item => {
      item.Balance = item.totalQty - item.BillQty;
      return item;
    });
    
    // Sort by factory and date
    resultArray.sort((a, b) => {
      if (a.Factory === b.Factory) {
        return b.Date - a.Date; // Newest first
      }
      return a.Factory.localeCompare(b.Factory);
    });
    
    console.log("Processed display data:", resultArray);
    setDailyData(resultArray);
    setFilteredData(resultArray);
  };

  useEffect(() => {
    if (dailyData.length === 0) return;
    
    let filtered = [...dailyData];
    
    // Filter by date
    if (selectedDate.trim()) {
      try {
        // Parse the input date (assuming DD/MM/YYYY format)
        const parts = selectedDate.split('/');
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
          const year = parseInt(parts[2], 10);
          
          const filterDate = new Date(year, month, day);
          
          if (!isNaN(filterDate.getTime())) {
            filtered = filtered.filter(item => {
              const itemDate = item.Date;
              return itemDate.getDate() === filterDate.getDate() &&
                     itemDate.getMonth() === filterDate.getMonth() &&
                     itemDate.getFullYear() === filterDate.getFullYear();
            });
          }
        }
      } catch (err) {
        console.error("Error filtering by date:", err);
      }
    }
    
    // Filter by factory
    if (selectedFactory) {
      filtered = filtered.filter(item => item.Factory === selectedFactory);
    }
    
    setFilteredData(filtered);
  }, [selectedDate, selectedFactory, dailyData]);

  const calculateTotals = () => {
    return filteredData.reduce((totals, item) => {
      totals.totalQty += item.totalQty;
      totals.BillQty += item.BillQty;
      totals.Balance += item.Balance;
      return totals;
    }, { totalQty: 0, BillQty: 0, Balance: 0 });
  };

  const clearFilters = () => {
    setSelectedDate("");
    setSelectedFactory("");
  };

  // Call logDebugInfo when component mounts and when data changes
  useEffect(() => {
    if (!loading) {
      logDebugInfo();
    }
  }, [loading, dailyData, filteredData]);

  if (loading) {
    return (
      <div style={{ 
        padding: 40, 
        textAlign: "center",
        minHeight: "300px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center"
      }}>
        <h3 style={{ marginBottom: 20 }}>Loading daily quantity report...</h3>
        <div style={{ width: "50px", height: "50px", border: "5px solid #f3f3f3", borderTop: "5px solid #3498db", borderRadius: "50%", animation: "spin 1s linear infinite" }}></div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ 
        padding: 40, 
        textAlign: "center",
        backgroundColor: "#ffe6e6",
        borderRadius: "8px",
        margin: "20px"
      }}>
        <h3 style={{ color: "#c00", marginBottom: 15 }}>Error Loading Data</h3>
        <p style={{ marginBottom: 20 }}>{error}</p>
        <button 
          onClick={() => window.location.reload()}
          style={{
            padding: "10px 20px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer"
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const totals = calculateTotals();

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", marginBottom: 30, color: "#333" }}>
        Daily Quantity Report
      </h1>
      
      {/* Debug Info Panel (visible only during development) */}
      <div style={{ 
        backgroundColor: "#f0f8ff", 
        padding: 15, 
        marginBottom: 20, 
        borderRadius: 8,
        border: "1px dashed #3498db",
        fontSize: "14px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong>Data Status:</strong> 
            <span style={{ color: dailyData.length > 0 ? "#27ae60" : "#e74c3c", marginLeft: 10 }}>
              {dailyData.length} records loaded
            </span>
            <span style={{ marginLeft: 20 }}>
              <strong>Factories:</strong> {allFactories.length} found
            </span>
          </div>
          <button 
            onClick={logDebugInfo}
            style={{
              padding: "5px 10px",
              backgroundColor: "#3498db",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "12px"
            }}
          >
            Show Console Logs
          </button>
        </div>
      </div>
      
      {/* Controls Section */}
      <div style={{ 
        backgroundColor: "#f8f9fa", 
        padding: "20px",
        borderRadius: "8px",
        marginBottom: "30px"
      }}>
        <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: "bold" }}>
              Select Factory:
            </label>
            <select
              value={selectedFactory}
              onChange={(e) => setSelectedFactory(e.target.value)}
              style={{ 
                width: "100%",
                padding: "10px", 
                border: "1px solid #ddd", 
                borderRadius: "6px"
              }}
            >
              <option value="">All Factories</option>
              {allFactories.map((factory, index) => (
                <option key={index} value={factory}>
                  {factory}
                </option>
              ))}
            </select>
          </div>
          
          <div style={{ flex: 1, minWidth: "200px" }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: "bold" }}>
              Enter Date (DD/MM/YYYY):
            </label>
            <input
              type="text"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              placeholder="DD/MM/YYYY"
              style={{ 
                width: "100%",
                padding: "10px", 
                border: "1px solid #ddd", 
                borderRadius: "6px"
              }}
            />
          </div>
        </div>
        
        <div style={{ display: "flex", gap: 15, justifyContent: "center" }}>
          <button
            onClick={() => {
              const today = new Date();
              const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
              setSelectedDate(todayStr);
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: "#28a745",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            Today's Date
          </button>
          
          <button
            onClick={clearFilters}
            style={{
              padding: "10px 20px",
              backgroundColor: "#6c757d",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer"
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>
      
      {/* Results Section */}
      {filteredData.length === 0 ? (
        <div style={{ 
          padding: "60px 40px", 
          textAlign: "center", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px"
        }}>
          <h3 style={{ color: "#666", marginBottom: "15px" }}>
            {dailyData.length === 0 ? "No data available" : "No matching records found"}
          </h3>
          <p style={{ color: "#777", marginBottom: "20px" }}>
            {dailyData.length === 0 
              ? "There are no dispatch records in the database."
              : "Try different filters or clear all filters to see all data."}
          </p>
          
          {/* Show raw data info if available */}
          {rawData.length > 0 && dailyData.length === 0 && (
            <div style={{ 
              marginTop: 20, 
              padding: 15, 
              backgroundColor: "#fff3cd", 
              borderRadius: 4,
              textAlign: "left"
            }}>
              <p><strong>Debug Info:</strong> Found {rawData.length} raw records but couldn't process them.</p>
              <p>This usually means dates are not in the expected format.</p>
              <button 
                onClick={() => console.log("Raw data:", rawData)}
                style={{
                  marginTop: 10,
                  padding: "8px 15px",
                  backgroundColor: "#f39c12",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                View Raw Data in Console
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Data Table */}
          <div style={{ overflowX: "auto", marginBottom: 30 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#2c3e50", color: "white" }}>
                  <th style={{ padding: "12px", border: "1px solid #34495e", textAlign: "left" }}>Factory</th>
                  <th style={{ padding: "12px", border: "1px solid #34495e", textAlign: "left" }}>Date</th>
                  <th style={{ padding: "12px", border: "1px solid #34495e", textAlign: "right" }}>Total Quantity</th>
                  <th style={{ padding: "12px", border: "1px solid #34495e", textAlign: "right" }}>Bill Quantity</th>
                  <th style={{ padding: "12px", border: "1px solid #34495e", textAlign: "right" }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, index) => (
                  <tr key={index} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "12px", border: "1px solid #eee" }}>{item.Factory}</td>
                    <td style={{ padding: "12px", border: "1px solid #eee" }}>{item.FormattedDate}</td>
                    <td style={{ padding: "12px", border: "1px solid #eee", textAlign: "right" }}>
                      {Math.round(item.totalQty * 100) / 100}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #eee", textAlign: "right" }}>
                      {Math.round(item.BillQty * 100) / 100}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #eee", textAlign: "right" }}>
                      {Math.round(item.Balance * 100) / 100}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Summary */}
          <div style={{ 
            padding: 20, 
            backgroundColor: "#f8f9fa", 
            borderRadius: 8,
            marginTop: 20
          }}>
            <h3 style={{ marginBottom: 15 }}>Summary</h3>
            <div style={{ display: "flex", gap: 20 }}>
              <div>
                <strong>Total Dispatch:</strong> {Math.round(totals.totalQty * 100) / 100}
              </div>
              <div>
                <strong>Total Billed:</strong> {Math.round(totals.BillQty * 100) / 100}
              </div>
              <div>
                <strong>Balance:</strong> {Math.round(totals.Balance * 100) / 100}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ShowDayQty;
