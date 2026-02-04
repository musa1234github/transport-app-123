import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

const ShowQtyByMonth = () => {
  const [monthlyData, setMonthlyData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [factorySearch, setFactorySearch] = useState("");
  const [allFactories, setAllFactories] = useState([]);

  // Month names for display
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Calculate date range for the selected year
        const startDate = new Date(selectedYear, 0, 1); // Jan 1 of selected year
        const endDate = new Date(selectedYear + 1, 0, 1); // Jan 1 of next year
        
        // Create query with date range filter - IMPORTANT: This reduces reads!
        const dispatchQuery = query(
          collection(db, "TblDispatch"),
          where("DispatchDate", ">=", startDate),
          where("DispatchDate", "<", endDate),
          orderBy("DispatchDate") // Ordering is required when using inequality filters
        );
        
        // Fetch only documents within the selected year
        const dispatchSnapshot = await getDocs(dispatchQuery);
        
        console.log(`Fetched ${dispatchSnapshot.size} documents for year ${selectedYear}`);
        
        // Collect unique factory names
        const factoryNamesSet = new Set();
        const factoryDataMap = new Map();
        
        const dispatchData = dispatchSnapshot.docs.map(doc => {
          const data = doc.data();
          
          // Get dispatch date
          let dispatchDate = null;
          if (data.DispatchDate?.seconds) {
            dispatchDate = new Date(data.DispatchDate.seconds * 1000);
          } else if (data.DispatchDate) {
            dispatchDate = new Date(data.DispatchDate);
          } else if (data.Date?.seconds) {
            dispatchDate = new Date(data.Date.seconds * 1000);
          } else if (data.Date) {
            dispatchDate = new Date(data.Date);
          }
          
          // Parse quantities
          const dispatchQuantity = parseFloat(data.DispatchQuantity) || 0;
          const unitPrice = parseFloat(data.UnitPrice) || parseFloat(data.Rate) || 0;
          
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
          
          // Add to factory names set
          if (factoryName !== "Unknown") {
            factoryNamesSet.add(factoryName);
          }
          
          // Store factory mapping for later use
          if (data.DisVid && !factoryDataMap.has(data.DisVid)) {
            factoryDataMap.set(data.DisVid, factoryName);
          }
          
          return {
            id: doc.id,
            ...data,
            DispatchDate: dispatchDate,
            DispatchQuantity: dispatchQuantity,
            UnitPrice: unitPrice,
            FactoryName: factoryName,
            FactoryId: data.DisVid
          };
        });

        // Convert set to array and sort alphabetically
        const factoryNamesArray = Array.from(factoryNamesSet).sort();
        setAllFactories(factoryNamesArray);
        
        // Process data
        processMonthlyData(dispatchData, selectedYear);
      } catch (error) {
        console.error("Error fetching data:", error);
        
        // Fallback: If query fails due to missing index, fetch minimal data
        // or prompt user to create the index
        if (error.code === 'failed-precondition') {
          console.error("Firestore index missing! Please create a composite index for TblDispatch with fields: DispatchDate ASC");
          alert("Database index is being created. Please try again in a moment.");
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [selectedYear]);

  useEffect(() => {
    // Filter data when factory search changes
    if (factorySearch.trim() === "") {
      setFilteredData(monthlyData);
    } else {
      const searchTerm = factorySearch.toLowerCase().trim();
      const filtered = monthlyData.filter(item => {
        const factoryMatch = item.Factory && item.Factory.toLowerCase().includes(searchTerm);
        const monthMatch = item.MonthName && item.MonthName.toLowerCase().includes(searchTerm);
        return factoryMatch || monthMatch;
      });
      setFilteredData(filtered);
    }
  }, [factorySearch, monthlyData]);

  const processMonthlyData = (dispatchData, year) => {
    // Filter out items without valid dates
    const validData = dispatchData.filter(item => item.DispatchDate instanceof Date);
    
    // Group data by factory and month
    const groupedData = {};
    
    // Initialize structure for grouping
    validData.forEach(item => {
      const itemYear = item.DispatchDate.getFullYear();
      if (itemYear !== year) return;
      
      const monthIndex = item.DispatchDate.getMonth();
      const monthName = MONTHS[monthIndex];
      const factoryName = item.FactoryName;
      
      // Create key for grouping
      const key = `${factoryName}-${monthName}`;
      
      if (!groupedData[key]) {
        groupedData[key] = {
          Factory: factoryName,
          MonthName: monthName,
          totalQty: 0,
          BillQty: 0,
          Balance: 0,
          monthIndex: monthIndex,
          year: year
        };
      }
      
      // Add to total quantity
      groupedData[key].totalQty += item.DispatchQuantity;
      
      // Add to bill quantity only if UnitPrice > 0
      const isBilled = item.UnitPrice > 0 || 
                      item.BillStatus === true || 
                      item.IsBilled === true ||
                      item.Billed === true;
      
      if (isBilled) {
        groupedData[key].BillQty += item.DispatchQuantity;
      }
    });
    
    // Calculate balance and convert to array
    const result = Object.values(groupedData).map(item => {
      item.Balance = item.totalQty - item.BillQty;
      return item;
    });
    
    // Sort by factory name, then by month
    result.sort((a, b) => {
      if (a.Factory < b.Factory) return -1;
      if (a.Factory > b.Factory) return 1;
      return a.monthIndex - b.monthIndex;
    });
    
    setMonthlyData(result);
    setFilteredData(result);
  };

  const getAvailableYears = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let year = currentYear - 5; year <= currentYear; year++) {
      years.push(year);
    }
    return years;
  };

  // Calculate totals for displayed data
  const calculateTotals = () => {
    return filteredData.reduce((totals, item) => {
      totals.totalQty += item.totalQty;
      totals.BillQty += item.BillQty;
      totals.Balance += item.Balance;
      return totals;
    }, { totalQty: 0, BillQty: 0, Balance: 0 });
  };

  // Add a refresh button with confirmation
  const handleRefresh = () => {
    if (window.confirm("Refresh data for the current year?")) {
      setLoading(true);
      // The useEffect will automatically run when selectedYear changes
      // Force a re-fetch by updating the year to itself
      setSelectedYear(prev => prev);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <h3>Loading monthly quantity report...</h3>
        <p>Fetching data for {selectedYear}...</p>
      </div>
    );
  }

  const totals = calculateTotals();

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ textAlign: "center", marginBottom: 30 }}>Quantity By Month</h1>
      
      {/* Debug Info */}
      <div style={{ 
        backgroundColor: "#f8f9fa", 
        padding: "10px",
        borderRadius: "5px",
        marginBottom: "20px",
        fontSize: "14px"
      }}>
        <p><strong>Selected Year:</strong> {selectedYear}</p>
        <p><strong>Available Factories:</strong> {allFactories.join(", ")}</p>
        <p><strong>Total Records:</strong> {monthlyData.length} monthly entries</p>
        <button 
          onClick={handleRefresh}
          style={{
            padding: "5px 10px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
            marginTop: "5px"
          }}
        >
          Refresh Data
        </button>
      </div>
      
      {/* Controls */}
      <div style={{ 
        display: "flex", 
        gap: 20, 
        alignItems: "center", 
        marginBottom: 20,
        flexWrap: "wrap" 
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontWeight: "bold", fontSize: "16px" }}>Select Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            style={{ 
              padding: "8px 12px", 
              border: "1px solid #ccc", 
              borderRadius: 4,
              fontSize: "16px",
              minWidth: "120px"
            }}
          >
            {getAvailableYears().map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontWeight: "bold", fontSize: "16px" }}>Search Factory:</label>
          <input
            type="text"
            placeholder="Type factory name (e.g., JSW, Ultratech)..."
            value={factorySearch}
            onChange={(e) => setFactorySearch(e.target.value)}
            style={{ 
              padding: "8px 12px", 
              border: "1px solid #ccc", 
              borderRadius: 4,
              fontSize: "16px",
              minWidth: "300px"
            }}
          />
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontWeight: "bold", fontSize: "16px" }}>Quick Filter:</label>
          <select
            value={factorySearch}
            onChange={(e) => setFactorySearch(e.target.value)}
            style={{ 
              padding: "8px 12px", 
              border: "1px solid #ccc", 
              borderRadius: 4,
              fontSize: "16px",
              minWidth: "150px"
            }}
          >
            <option value="">All Factories</option>
            {allFactories.map(factory => (
              <option key={factory} value={factory}>{factory}</option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Rest of your component remains the same */}
      {filteredData.length === 0 ? (
        <div style={{ 
          padding: 40, 
          textAlign: "center", 
          backgroundColor: "#f8f9fa", 
          borderRadius: 8,
          border: "1px dashed #ccc"
        }}>
          <h3>No data found {factorySearch ? `for "${factorySearch}"` : `for ${selectedYear}`}</h3>
          <p>Try a different search term or year.</p>
          <p style={{ marginTop: 10 }}>
            <button 
              onClick={() => setFactorySearch("")}
              style={{
                padding: "8px 16px",
                backgroundColor: "#007bff",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              Clear Search
            </button>
          </p>
        </div>
      ) : (
        <>
          {/* Results count */}
          <div style={{ 
            marginBottom: 15, 
            padding: "10px",
            backgroundColor: "#e7f3ff",
            borderRadius: "5px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <span>
              Showing <strong>{filteredData.length}</strong> record(s) 
              {factorySearch && ` for "${factorySearch}"`}
            </span>
            {factorySearch && (
              <button 
                onClick={() => setFactorySearch("")}
                style={{
                  padding: "5px 10px",
                  backgroundColor: "#6c757d",
                  color: "white",
                  border: "none",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "14px"
                }}
              >
                Clear Filter
              </button>
            )}
          </div>
          
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f2f2f2" }}>
                  <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>
                    Factory
                  </th>
                  <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>
                    Month
                  </th>
                  <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>
                    Total Quantity
                  </th>
                  <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>
                    Bill Quantity
                  </th>
                  <th style={{ padding: "12px", border: "1px solid #ddd", textAlign: "left" }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, index) => (
                  <tr 
                    key={`${item.Factory}-${item.MonthName}-${index}`}
                    style={{ 
                      borderBottom: "1px solid #ddd",
                      backgroundColor: index % 2 === 0 ? "#ffffff" : "#f9f9f9"
                    }}
                  >
                    <td style={{ padding: "12px", border: "1px solid #ddd", fontWeight: "bold" }}>
                      {item.Factory}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #ddd" }}>
                      {item.MonthName}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #ddd", textAlign: "right" }}>
                      {Math.round(item.totalQty * 100) / 100}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #ddd", textAlign: "right" }}>
                      {Math.round(item.BillQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "12px", 
                      border: "1px solid #ddd", 
                      textAlign: "right",
                      fontWeight: "bold",
                      color: item.Balance >= 0 ? "#28a745" : "#dc3545"
                    }}>
                      {Math.round(item.Balance * 100) / 100}
                    </td>
                  </tr>
                ))}
                
                {/* Total Row */}
                {filteredData.length > 0 && (
                  <tr style={{ backgroundColor: "#e9ecef", fontWeight: "bold" }}>
                    <td style={{ padding: "12px", border: "1px solid #ddd" }} colSpan="2">
                      TOTAL
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #ddd", textAlign: "right" }}>
                      {Math.round(totals.totalQty * 100) / 100}
                    </td>
                    <td style={{ padding: "12px", border: "1px solid #ddd", textAlign: "right" }}>
                      {Math.round(totals.BillQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "12px", 
                      border: "1px solid #ddd", 
                      textAlign: "right",
                      color: totals.Balance >= 0 ? "#28a745" : "#dc3545"
                    }}>
                      {Math.round(totals.Balance * 100) / 100}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          
          {/* Summary Cards */}
          <div style={{ 
            marginTop: 30, 
            display: "flex", 
            gap: 20, 
            flexWrap: "wrap",
            justifyContent: "center" 
          }}>
            <div style={{
              backgroundColor: "#007bff",
              color: "white",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "200px",
              textAlign: "center",
              flex: 1
            }}>
              <h4>Total Dispatch</h4>
              <h3>{Math.round(totals.totalQty * 100) / 100}</h3>
            </div>
            
            <div style={{
              backgroundColor: "#28a745",
              color: "white",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "200px",
              textAlign: "center",
              flex: 1
            }}>
              <h4>Total Billed</h4>
              <h3>{Math.round(totals.BillQty * 100) / 100}</h3>
            </div>
            
            <div style={{
              backgroundColor: totals.Balance >= 0 ? "#17a2b8" : "#dc3545",
              color: "white",
              padding: "20px",
              borderRadius: "8px",
              minWidth: "200px",
              textAlign: "center",
              flex: 1
            }}>
              <h4>Total Balance</h4>
              <h3>{Math.round(totals.Balance * 100) / 100}</h3>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ShowQtyByMonth;