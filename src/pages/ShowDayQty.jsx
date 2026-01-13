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

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch dispatch data from TblDispatch
        const dispatchSnapshot = await getDocs(collection(db, "TblDispatch"));
        
        // Collect unique factory names
        const factoryNamesSet = new Set();
        
        const dispatchData = dispatchSnapshot.docs.map(doc => {
          const data = doc.data();
          
          // Get dispatch date
          let dispatchDate = null;
          if (data.DispatchDate?.seconds) {
            dispatchDate = new Date(data.DispatchDate.seconds * 1000);
          } else if (data.DispatchDate) {
            dispatchDate = new Date(data.DispatchDate);
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
          
          if (factoryName !== "Unknown") {
            factoryNamesSet.add(factoryName);
          }
          
          return {
            id: doc.id,
            ...data,
            DispatchDate: dispatchDate,
            DispatchQuantity: dispatchQuantity,
            UnitPrice: unitPrice,
            FactoryName: factoryName,
            FactoryId: data.DisVid,
            // Add formatted date strings for easier filtering
            DateISO: dispatchDate ? dispatchDate.toISOString().split('T')[0] : null,
            DateDDMMYYYY: dispatchDate ? 
              `${String(dispatchDate.getDate()).padStart(2, '0')}/${String(dispatchDate.getMonth() + 1).padStart(2, '0')}/${dispatchDate.getFullYear()}` : null
          };
        });

        const factoryNamesArray = Array.from(factoryNamesSet).sort();
        setAllFactories(factoryNamesArray);
        
        // Process all data initially
        processDailyData(dispatchData);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Filter data when selectedDate or selectedFactory changes
  useEffect(() => {
    if (dailyData.length === 0) return;
    
    let filtered = [...dailyData];
    
    // Filter by date if date is entered
    if (selectedDate.trim()) {
      const parsedDate = parseDateInput(selectedDate);
      if (parsedDate) {
        filtered = filtered.filter(item => {
          if (!item.DispatchDate) return false;
          return isSameDay(item.DispatchDate, parsedDate);
        });
      }
    }
    
    // Filter by factory if factory is selected
    if (selectedFactory) {
      filtered = filtered.filter(item => item.FactoryName === selectedFactory);
    }
    
    setFilteredData(filtered);
  }, [selectedDate, selectedFactory, dailyData]);

  const processDailyData = (dispatchData) => {
    const groupedData = {};
    
    dispatchData.forEach(item => {
      if (!item.DispatchDate) return;
      
      const factoryName = item.FactoryName;
      const dateKey = item.DateDDMMYYYY;
      const key = `${factoryName}-${dateKey}`;
      
      if (!groupedData[key]) {
        groupedData[key] = {
          Factory: factoryName,
          Date: item.DispatchDate,
          FormattedDate: item.DateDDMMYYYY,
          Day: item.DispatchDate.getDate(),
          totalQty: 0,
          BillQty: 0,
          Balance: 0
        };
      }
      
      groupedData[key].totalQty += item.DispatchQuantity;
      
      const isBilled = item.UnitPrice > 0 || 
                      item.BillStatus === true || 
                      item.IsBilled === true ||
                      item.Billed === true;
      
      if (isBilled) {
        groupedData[key].BillQty += item.DispatchQuantity;
      }
    });
    
    const result = Object.values(groupedData).map(item => {
      item.Balance = item.totalQty - item.BillQty;
      return item;
    });
    
    // Sort by factory name, then by date
    result.sort((a, b) => {
      if (a.Factory === b.Factory) {
        return b.Date - a.Date; // Newest first
      }
      return a.Factory.localeCompare(b.Factory);
    });
    
    setDailyData(result);
    setFilteredData(result);
  };

  // Parse date input in DD/MM/YYYY format - FIXED VERSION
  const parseDateInput = (dateString) => {
    const trimmed = dateString.trim();
    if (!trimmed) return null;
    
    // Define date patterns
    const patterns = [
      { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, hasYear: true }, // DD/MM/YYYY
      { regex: /^(\d{1,2})\/(\d{1,2})$/, hasYear: false }, // DD/MM
      { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, hasYear: true }, // DD-MM-YYYY
      { regex: /^(\d{1,2})-(\d{1,2})$/, hasYear: false }, // DD-MM
      { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, hasYear: true, isYYYYMMDD: true }, // YYYY-MM-DD
    ];
    
    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        let day, month, year;
        
        if (pattern.isYYYYMMDD) {
          // YYYY-MM-DD format
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else if (!pattern.hasYear) {
          // DD/MM or DD-MM format (no year)
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = new Date().getFullYear();
        } else {
          // DD/MM/YYYY or DD-MM-YYYY format
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = parseInt(match[3], 10);
        }
        
        // Validate date
        const date = new Date(year, month, day);
        if (
          date.getDate() === day &&
          date.getMonth() === month &&
          date.getFullYear() === year
        ) {
          return date;
        }
      }
    }
    
    return null;
  };

  // Check if two dates are the same day
  const isSameDay = (date1, date2) => {
    return date1.getDate() === date2.getDate() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getFullYear() === date2.getFullYear();
  };

  const calculateTotals = () => {
    return filteredData.reduce((totals, item) => {
      totals.totalQty += item.totalQty;
      totals.BillQty += item.BillQty;
      totals.Balance += item.Balance;
      return totals;
    }, { totalQty: 0, BillQty: 0, Balance: 0 });
  };

  const formatDateForDisplay = (date) => {
    if (!date) return 'N/A';
    const dateObj = date instanceof Date ? date : new Date(date);
    return `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`;
  };

  const clearFilters = () => {
    setSelectedDate("");
    setSelectedFactory("");
  };

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center" }}>
        <h3>Loading daily quantity report...</h3>
      </div>
    );
  }

  const totals = calculateTotals();

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ textAlign: "center", marginBottom: 30, color: "#333" }}>
        Daily Quantity Report
      </h1>
      
      {/* Controls Section */}
      <div style={{ 
        backgroundColor: "#f8f9fa", 
        padding: "20px",
        borderRadius: "8px",
        marginBottom: "30px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
      }}>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "1fr 1fr", 
          gap: "20px",
          marginBottom: "20px"
        }}>
          {/* Factory Dropdown */}
          <div>
            <label style={{ 
              display: "block", 
              marginBottom: "8px", 
              fontWeight: "bold",
              fontSize: "16px",
              color: "#555"
            }}>
              Select Factory:
            </label>
            <select
              value={selectedFactory}
              onChange={(e) => setSelectedFactory(e.target.value)}
              style={{ 
                width: "100%",
                padding: "10px 12px", 
                border: "1px solid #ddd", 
                borderRadius: "6px",
                fontSize: "16px",
                backgroundColor: "white",
                cursor: "pointer"
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
          
          {/* Manual Date Input */}
          <div>
            <label style={{ 
              display: "block", 
              marginBottom: "8px", 
              fontWeight: "bold",
              fontSize: "16px",
              color: "#555"
            }}>
              Enter Date:
            </label>
            <input
              type="text"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              placeholder="DD/MM/YYYY or DD/MM"
              style={{ 
                width: "100%",
                padding: "10px 12px", 
                border: "1px solid #ddd", 
                borderRadius: "6px",
                fontSize: "16px",
                backgroundColor: "white"
              }}
            />
            <div style={{ 
              marginTop: "5px", 
              fontSize: "14px", 
              color: "#666",
              fontStyle: "italic"
            }}>
              Format: DD/MM/YYYY or DD/MM
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div style={{ 
          display: "flex", 
          gap: "15px",
          justifyContent: "center"
        }}>
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
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "bold",
              minWidth: "150px"
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
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "bold",
              minWidth: "150px"
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>
      
      {/* Results Summary */}
      {(selectedDate || selectedFactory) && (
        <div style={{ 
          marginBottom: "20px", 
          padding: "15px",
          backgroundColor: "#e7f3ff",
          borderRadius: "6px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <span style={{ fontSize: "16px" }}>
            <strong>Filters Applied:</strong> 
            {selectedDate && ` Date: ${selectedDate}`}
            {selectedFactory && ` Factory: ${selectedFactory}`}
          </span>
          <span style={{ fontSize: "16px", fontWeight: "bold" }}>
            Showing {filteredData.length} record(s)
          </span>
        </div>
      )}
      
      {filteredData.length === 0 ? (
        <div style={{ 
          padding: "60px 40px", 
          textAlign: "center", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          border: "2px dashed #ddd"
        }}>
          <h3 style={{ color: "#666", marginBottom: "15px" }}>
            No data found
          </h3>
          <p style={{ color: "#777", marginBottom: "20px" }}>
            {selectedDate || selectedFactory 
              ? "Try different filters or clear all filters to see all data."
              : "No dispatch records available."}
          </p>
          <button 
            onClick={clearFilters}
            style={{
              padding: "10px 25px",
              backgroundColor: "#007bff",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "16px",
              fontWeight: "bold"
            }}
          >
            {selectedDate || selectedFactory ? "Clear Filters" : "Refresh Data"}
          </button>
        </div>
      ) : (
        <>
          {/* Data Table */}
          <div style={{ 
            overflowX: "auto", 
            marginBottom: "30px",
            borderRadius: "8px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
          }}>
            <table style={{ 
              width: "100%", 
              borderCollapse: "collapse",
              backgroundColor: "white"
            }}>
              <thead>
                <tr style={{ 
                  backgroundColor: "#2c3e50",
                  color: "white"
                }}>
                  <th style={{ 
                    padding: "15px", 
                    border: "1px solid #34495e", 
                    textAlign: "left",
                    fontSize: "16px"
                  }}>
                    Factory
                  </th>
                  <th style={{ 
                    padding: "15px", 
                    border: "1px solid #34495e", 
                    textAlign: "left",
                    fontSize: "16px"
                  }}>
                    Date
                  </th>
                  <th style={{ 
                    padding: "15px", 
                    border: "1px solid #34495e", 
                    textAlign: "right",
                    fontSize: "16px"
                  }}>
                    Total Quantity
                  </th>
                  <th style={{ 
                    padding: "15px", 
                    border: "1px solid #34495e", 
                    textAlign: "right",
                    fontSize: "16px"
                  }}>
                    Bill Quantity
                  </th>
                  <th style={{ 
                    padding: "15px", 
                    border: "1px solid #34495e", 
                    textAlign: "right",
                    fontSize: "16px"
                  }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, index) => (
                  <tr 
                    key={`${item.Factory}-${item.FormattedDate}-${index}`}
                    style={{ 
                      borderBottom: "1px solid #eee",
                      backgroundColor: index % 2 === 0 ? "#ffffff" : "#f9f9f9"
                    }}
                  >
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #eee",
                      fontWeight: "bold",
                      color: "#2c3e50"
                    }}>
                      {item.Factory}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #eee",
                      color: "#555"
                    }}>
                      {item.FormattedDate}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #eee", 
                      textAlign: "right",
                      fontWeight: "bold",
                      color: "#2c3e50"
                    }}>
                      {Math.round(item.totalQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #eee", 
                      textAlign: "right",
                      color: "#28a745"
                    }}>
                      {Math.round(item.BillQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #eee", 
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
                  <tr style={{ 
                    backgroundColor: "#34495e",
                    color: "white",
                    fontWeight: "bold"
                  }}>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #2c3e50"
                    }} colSpan="2">
                      TOTAL
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #2c3e50", 
                      textAlign: "right"
                    }}>
                      {Math.round(totals.totalQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #2c3e50", 
                      textAlign: "right"
                    }}>
                      {Math.round(totals.BillQty * 100) / 100}
                    </td>
                    <td style={{ 
                      padding: "15px", 
                      border: "1px solid #2c3e50", 
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
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", 
            gap: "20px",
            marginTop: "30px"
          }}>
            <div style={{
              backgroundColor: "#3498db",
              color: "white",
              padding: "25px",
              borderRadius: "8px",
              textAlign: "center",
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
            }}>
              <h3 style={{ marginBottom: "10px", fontSize: "20px" }}>Total Dispatch</h3>
              <div style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "5px" }}>
                {Math.round(totals.totalQty * 100) / 100}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.9 }}>
                All Filtered Records
              </div>
            </div>
            
            <div style={{
              backgroundColor: "#2ecc71",
              color: "white",
              padding: "25px",
              borderRadius: "8px",
              textAlign: "center",
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
            }}>
              <h3 style={{ marginBottom: "10px", fontSize: "20px" }}>Total Billed</h3>
              <div style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "5px" }}>
                {Math.round(totals.BillQty * 100) / 100}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.9 }}>
                All Filtered Records
              </div>
            </div>
            
            <div style={{
              backgroundColor: totals.Balance >= 0 ? "#9b59b6" : "#e74c3c",
              color: "white",
              padding: "25px",
              borderRadius: "8px",
              textAlign: "center",
              boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
            }}>
              <h3 style={{ marginBottom: "10px", fontSize: "20px" }}>Total Balance</h3>
              <div style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "5px" }}>
                {Math.round(totals.Balance * 100) / 100}
              </div>
              <div style={{ fontSize: "14px", opacity: 0.9 }}>
                All Filtered Records
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ShowDayQty;