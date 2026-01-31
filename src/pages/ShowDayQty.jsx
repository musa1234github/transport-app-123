import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
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
        const dispatchSnapshot = await getDocs(collection(db, "TblDispatch"));

        if (dispatchSnapshot.empty) {
          setAllFactories([]);
          return;
        }

        const factoryNamesSet = new Set();

        dispatchSnapshot.docs.forEach(doc => {
          const data = doc.data();
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

        const sortedFactories = Array.from(factoryNamesSet).sort();
        setAllFactories(sortedFactories);
        console.log("Loaded factories:", sortedFactories);

      } catch (error) {
        console.error("Error fetching factory names:", error);
        setError(`Failed to load factory list: ${error.message}`);
      } finally {
        setLoadingFactories(false);
      }
    };

    fetchFactoryNames();
  }, []); // Empty dependency array means this runs once on mount

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

      const dispatchSnapshot = await getDocs(collection(db, "TblDispatch"));

      if (dispatchSnapshot.empty) {
        setError("No dispatch records found in the database.");
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
          return b.Date - a.Date;
        }
        return a.Factory.localeCompare(b.Factory);
      });

      setDailyData(resultArray);

      // Apply filters to the fetched data
      applyFilters(resultArray, selectedDate, selectedFactory);

    } catch (error) {
      console.error("Error fetching data:", error);
      setError(`Failed to fetch data: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = (data, date, factory) => {
    let filtered = [...data];

    if (date.trim()) {
      try {
        const parts = date.split('/');
        if (parts.length === 3) {
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
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

    if (factory) {
      filtered = filtered.filter(item => item.Factory === factory);
    }

    setFilteredData(filtered);
  };

  const handleSearch = () => {
    if (dailyData.length === 0) {
      fetchData();
    } else {
      applyFilters(dailyData, selectedDate, selectedFactory);
    }
  };

  const handleClear = () => {
    setSelectedDate("");
    setSelectedFactory("");
    setFilteredData([]);
    setHasSearched(false);
    setError(null);
    setDailyData([]);
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

  if (loading) {
    return (
      <div className="loading-container">
        <h3>Loading data...</h3>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  const totals = filteredData.length > 0 ? calculateTotals() : null;

  return (
    <div className="container">
      <h1 className="title">Daily Quantity Report</h1>

      {/* Controls Section */}
      <div className="controls">
        <div className="controls-row">
          <div className="form-group">
            <label className="form-label">Select Factory:</label>
            {loadingFactories ? (
              <div className="form-input" style={{ color: '#666', fontStyle: 'italic' }}>
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
            <input
              type="text"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              placeholder="DD/MM/YYYY"
              className="form-input"
            />
          </div>
        </div>

        <div className="controls-buttons">
          <button
            onClick={handleTodayDate}
            className="button button-secondary"
          >
            Today's Date
          </button>

          <button
            onClick={handleSearch}
            className="button button-primary"
            disabled={(!selectedDate && !selectedFactory) || loadingFactories}
            style={{
              opacity: (!selectedDate && !selectedFactory) || loadingFactories ? 0.5 : 1,
              cursor: (!selectedDate && !selectedFactory) || loadingFactories ? 'not-allowed' : 'pointer'
            }}
          >
            Search
          </button>

          <button
            onClick={handleClear}
            className="button button-secondary"
          >
            Clear
          </button>
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
            style={{ marginTop: '10px' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Loading factories message */}
      {loadingFactories && !error && (
        <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
          Loading factory list...
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
          <p className="no-data-text">Try different filters or clear all filters to start over.</p>
        </div>
      )}

      {/* Data Table */}
      {/* Data Table */}
      {filteredData.length > 0 && (
        <>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr style={{
                  backgroundColor: '#2c3e50',
                  color: 'white',
                  fontWeight: '600'
                }}>
                  <th style={{
                    padding: '12px 15px',
                    border: '1px solid #34495e',
                    textAlign: 'left'
                  }}>Factory</th>
                  <th style={{
                    padding: '12px 15px',
                    border: '1px solid #34495e',
                    textAlign: 'left'
                  }}>Date</th>
                  <th style={{
                    padding: '12px 15px',
                    border: '1px solid #34495e',
                    textAlign: 'right'
                  }}>Total Quantity</th>
                  <th style={{
                    padding: '12px 15px',
                    border: '1px solid #34495e',
                    textAlign: 'right'
                  }}>Bill Quantity</th>
                  <th style={{
                    padding: '12px 15px',
                    border: '1px solid #34495e',
                    textAlign: 'right'
                  }}>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((item, index) => (
                  <tr key={index} className="table-body">
                    <td>{item.Factory}</td>
                    <td>{item.FormattedDate}</td>
                    <td className="text-right">{Math.round(item.totalQty * 100) / 100}</td>
                    <td className="text-right">{Math.round(item.BillQty * 100) / 100}</td>
                    <td className="text-right">{Math.round(item.Balance * 100) / 100}</td>
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
          )}
        </>
      )}
    </div>
  );
};

export default ShowDayQty;