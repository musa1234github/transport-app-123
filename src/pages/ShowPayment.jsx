// ShowPayment.jsx
import React, { useEffect, useState, useMemo } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
  updateDoc,
  doc,
  serverTimestamp,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import * as XLSX from 'xlsx';
import './ShowPayment.css';

/* ===== HELPER FUNCTIONS ===== */
const toDate = (v) => {
  if (!v) return null;
  // Firestore Timestamp object with toDate() method
  if (typeof v.toDate === 'function') return v.toDate();
  // Plain object with seconds property (serialized Timestamp)
  if (v.seconds !== undefined) return new Date(v.seconds * 1000);
  // Already a Date object
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  // Number (epoch milliseconds or seconds)
  if (typeof v === 'number') {
    // If the number is very large, it's likely epoch ms; if small, epoch seconds
    const d = v > 1e12 ? new Date(v) : new Date(v * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  // String fallback
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const formatDate = (date) => {
  if (!date) return "";
  try {
    if (isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = date.getMonth();
    const month = monthNames[monthIndex];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch (error) {
    console.error("Error formatting date:", date, error);
    return "";
  }
};

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

const ShowPayment = ({ userRole }) => {
  // Check if user is admin
  const isAdmin = userRole === "admin";

  const [allRows, setAllRows] = useState([]);   // All fetched records
  const [loading, setLoading] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [hasRequestedData, setHasRequestedData] = useState(false);
  const [factories, setFactories] = useState([]); // Separate state for factories
  const [loadingFactories, setLoadingFactories] = useState(true); // Track factory loading

  // Edit State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState(null);
  const [editFormData, setEditFormData] = useState({
    PaymentDate: ""
  });

  /* ===== CLIENT-SIDE PAGINATION STATES ===== */
  const RECORDS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1); // 1-indexed

  /* ===== FILTER STATES ===== */
  const [searchTerm, setSearchTerm] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("");

  /* ===== SERVER-SIDE PAGINATION STATES ===== */
  const BILLS_PER_PAGE = 20;
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [pageHistory, setPageHistory] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  /* ===== APPLY FILTERS STATE ===== */
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    searchTerm: "",
    factoryFilter: "",
    paymentTypeFilter: ""
  });

  /* ================= LOAD FACTORIES WITH CACHE ================= */
  // Ensure these factories are always present regardless of Firestore state
  const REQUIRED_FACTORIES = ["JSW"];

  const mergeRequiredFactories = (list) => {
    const merged = new Set(list);
    REQUIRED_FACTORIES.forEach(f => merged.add(f));
    return Array.from(merged).sort();
  };

  const loadFactories = async (forceRefresh = false) => {
    setLoadingFactories(true);
    try {
      // Check cache first (7 day expiry for better performance)
      const CACHE_KEY = 'paymentFactoriesCache';
      const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

      if (!forceRefresh) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          try {
            const { factories, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;

            if (age < CACHE_EXPIRY_MS) {
              // Always merge required factories in case cache is stale
              const merged = mergeRequiredFactories(factories);
              const ageHours = Math.round(age / 1000 / 60 / 60);
              console.log(`Using cached factories for payment (age: ${ageHours} hours). Merged required factories.`);

              // If merged list differs from cached, update the cache
              if (merged.length !== factories.length) {
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                  factories: merged,
                  timestamp // preserve original timestamp so it expires naturally
                }));
              }

              setFactories(merged);
              setLoadingFactories(false);
              return;
            }
          } catch (e) {
            console.error('Cache parse error:', e);
          }
        }
      }

      // Cache miss or expired - load from Factories collection
      console.log('Loading factories from Factories collection...');

      try {
        // OPTIMIZED: Read from dedicated Factories collection (3-5 reads)
        // Instead of scanning all BillTable (100-5000 reads)
        const factoriesQuery = query(
          collection(db, "Factories"),
          where("hasPayments", "==", true)
        );

        const factoriesSnap = await getDocs(factoriesQuery);

        if (factoriesSnap.empty) {
          console.warn('⚠️ Factories collection is empty. Falling back to BillTable scan.');
          console.warn('💡 Run the migration script: node populate_factories_collection.js');

          // FALLBACK: If Factories collection doesn't exist yet, scan BillTable (capped)
          const billQuery = query(
            collection(db, "BillTable"),
            where("PaymentReceived", ">", 0),
            limit(1000)
          );
          const billSnap = await getDocs(billQuery);

          const factorySet = new Set();
          billSnap.docs.forEach(b => {
            const data = b.data();
            if (data.FactoryName) {
              factorySet.add(data.FactoryName);
            }
          });

          const factoriesList = mergeRequiredFactories(Array.from(factorySet));
          setFactories(factoriesList);

          // Cache for next time
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            factories: factoriesList,
            timestamp: Date.now()
          }));

          return;
        }

        // Extract factory names from Factories collection, always include required factories
        const rawList = factoriesSnap.docs.map(doc => doc.data().displayName || doc.id);
        const factoriesList = mergeRequiredFactories(rawList);

        console.log(`✅ Loaded ${factoriesList.length} factories (${factoriesSnap.docs.length} from Firestore + required merges)`);
        setFactories(factoriesList);

        // Cache for next time
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          factories: factoriesList,
          timestamp: Date.now()
        }));

      } catch (error) {
        console.error('Error loading from Factories collection:', error);
        // If Factories collection doesn't exist, we'll get an error
        // The fallback logic above will handle it
        throw error;
      }

    } catch (error) {
      console.error("Error loading factories:", error);
      // Even on error, make sure required factories are available
      setFactories(prev => mergeRequiredFactories(prev));
    } finally {
      setLoadingFactories(false);
    }
  };

  /* ================= PROCESS DOCS INTO BILL DATA ================= */
  const processDocs = (docs, fromDateObj, toDateObj, hasDateFilter) => {
    const billData = [];
    docs.forEach((billDoc) => {
      const bill = billDoc.data();

      // Resolve payment date: prefer PaymentRecDate, fallback to PaymentDate field
      const paymentRecDate = toDate(bill.PaymentRecDate) || toDate(bill.PaymentDate) || null;

      // CLIENT-SIDE SAFETY NET: verify each record actually falls in range
      if (hasDateFilter) {
        if (!paymentRecDate) return;
        if (fromDateObj && paymentRecDate < fromDateObj) return;
        if (toDateObj && paymentRecDate > toDateObj) return;
      }

      billData.push({
        id: billDoc.id,
        FactoryName: bill.FactoryName || "",
        BillNum: bill.BillNum || "",
        BillDate: toDate(bill.BillDate) || null,
        PaymentReceived: toNum(bill.PaymentReceived),
        ActualAmount: toNum(bill.ActualAmount),
        Tds: toNum(bill.Tds),
        Gst: toNum(bill.Gst),
        PaymentNumber: bill.PaymentNumber || "",
        BillType: bill.BillType || "",
        PaymentDate: paymentRecDate,
        Shortage: toNum(bill.PaymentShortage || bill.Shortage || 0),
        TotalShortage: 0,
        BillDateObj: toDate(bill.BillDate),
        BillDateSortKey: formatDate(toDate(bill.BillDate))
      });
    });
    return billData;
  };

  /* ================= LOAD ALL MATCHING PAYMENT DATA ================= */
  // Uses client-side pagination to avoid composite index requirement.
  // Fetches ALL records matching the filter and paginates in memory.
  /* ================= LOAD DATA WITH CURSOR PAGINATION ================= */
  const load = async (direction = 'initial', cursorDoc = null) => {
    setLoading(true);
    try {
      if (!appliedFilters.factoryFilter && !appliedFilters.fromDate && !appliedFilters.toDate) {
        setLoading(false);
        return;
      }

      let queryConstraints = [];
      const hasDateFilter = !!(appliedFilters.fromDate || appliedFilters.toDate);

      if (hasDateFilter) {
        // A payment report should filter by the Payment Date!
        if (appliedFilters.fromDate) {
          const d = new Date(appliedFilters.fromDate);
          d.setHours(0, 0, 0, 0);
          queryConstraints.push(where("PaymentRecDate", ">=", Timestamp.fromDate(d)));
        }
        if (appliedFilters.toDate) {
          const d = new Date(appliedFilters.toDate);
          d.setHours(23, 59, 59, 999);
          queryConstraints.push(where("PaymentRecDate", "<=", Timestamp.fromDate(d)));
        }
        queryConstraints.push(orderBy("PaymentRecDate", "desc"));
        // Omitting FactoryName server-side to prevent composite index crash on (PaymentRecDate + FactoryName).
      } else {
        if (appliedFilters.factoryFilter) {
          queryConstraints.push(where("FactoryName", "==", appliedFilters.factoryFilter));
        }
        queryConstraints.push(orderBy("BillDate", "desc"));
      }

      let billQuery;
      // When using date filter, we want to fetch all records (up to a large limit) so they can be exported
      // Otherwise, we use a larger scan limit (400) because limit(21) on BillTable includes UNPAID bills.
      const SCAN_LIMIT = hasDateFilter ? 2000 : 400;

      if (direction === 'next' && cursorDoc) {
        billQuery = query(collection(db, "BillTable"), ...queryConstraints, startAfter(cursorDoc), limit(SCAN_LIMIT));
      } else if (direction === 'prev' && cursorDoc) {
        billQuery = query(collection(db, "BillTable"), ...queryConstraints, endBefore(cursorDoc), limitToLast(SCAN_LIMIT));
      } else {
        billQuery = query(collection(db, "BillTable"), ...queryConstraints, limit(SCAN_LIMIT));
      }

      const snap = await getDocs(billQuery);
      const docs = snap.docs;
      const serverHasMore = docs.length === SCAN_LIMIT;

      // Extract all documents from server scan
      let billData = processDocs(docs, null, null, false);

      // Filter only paid ones for the report view
      let allPaidThisScan = billData.filter(r => r.PaymentReceived > 0);

      // Client-side Factory filtering if we used PaymentRecDate backend query
      if (hasDateFilter && appliedFilters.factoryFilter) {
          allPaidThisScan = allPaidThisScan.filter(r => r.FactoryName === appliedFilters.factoryFilter);
      }

      // We no longer slice to BILLS_PER_PAGE so all scanned matching payments are available to export and view.
      const displayData = allPaidThisScan;
      if (displayData.length > 0) {
        const firstRowId = displayData[0].id;
        const lastRowId = displayData[displayData.length - 1].id;

        setFirstDoc(docs.find(d => d.id === firstRowId));

        // If we filled a page, the last doc is the 20th item's doc.
        // If we didn't fill a page but the server has more docs, the last doc is the very last doc scanned so we can continue from there.
        let nextCursorDoc;
        let canGoNext = false;
        
        let limitReached = hasDateFilter ? false : (allPaidThisScan.length > BILLS_PER_PAGE);

        if (limitReached) {
          nextCursorDoc = docs.find(d => d.id === lastRowId);
          canGoNext = true;
        } else if (serverHasMore) {
          nextCursorDoc = docs[docs.length - 1]; // Advance cursor to end of chunk explicitly
          canGoNext = true;
        } else {
          nextCursorDoc = docs.find(d => d.id === lastRowId);
          canGoNext = false;
        }

        setLastDoc(nextCursorDoc);

        if (direction === 'next') {
          setHasNextPage(canGoNext);
          setHasPrevPage(true);
        } else if (direction === 'prev') {
          setHasPrevPage(serverHasMore || limitReached);
          setHasNextPage(true);
        } else {
          setHasNextPage(canGoNext);
          setHasPrevPage(false);
        }
      } else {
        // We found NO paid bills in this 400-document scan!
        if (serverHasMore) {
          setLastDoc(docs[docs.length - 1]);
          setHasNextPage(true); // Let them keep clicking next to scan further
          setFirstDoc(null);
        } else {
          setHasNextPage(false);
          setLastDoc(null);
          setFirstDoc(null);
        }
      }

      billData = displayData;

      // ===== BULK ENRICH MISSING BillDate/BillType (Zero-Read Optimization) =====
      const billNums = billData.filter(r => !r.BillDate || !r.BillType).map(r => r.BillNum);
      if (billNums.length > 0) {
        const lookup = {};
        const chunkSize = 30;
        for (let i = 0; i < billNums.length; i += chunkSize) {
          const chunk = billNums.slice(i, i + chunkSize);
          const q = query(collection(db, "BillTable"), where("BillNum", "in", chunk));
          const enrichSnap = await getDocs(q);
          enrichSnap.forEach(d => {
            const data = d.data();
            if (data.BillDate || data.BillType) {
              const existing = lookup[data.BillNum] || {};
              lookup[data.BillNum] = {
                BillDate: data.BillDate ? toDate(data.BillDate) : existing.BillDate,
                BillType: data.BillType || existing.BillType
              };
            }
          });
        }

        billData.forEach(row => {
          const info = lookup[row.BillNum];
          if (info) {
            if (!row.BillDate && info.BillDate) {
              row.BillDate = info.BillDate;
              row.BillDateObj = info.BillDate;
              row.BillDateSortKey = formatDate(info.BillDate);
            }
            if (!row.BillType && info.BillType) {
              row.BillType = info.BillType;
            }
          }
        });
      }

      setAllRows(billData);
      setPageHistory(prev => {
        const newHist = [...prev];
        let hasMoreItemsLocal = hasDateFilter ? false : (allPaidThisScan.length > BILLS_PER_PAGE);
        newHist[currentPageIndex] = {
          rows: billData,
          firstDoc: billData.length > 0 ? docs.find(d => d.id === billData[0].id) : null,
          lastDoc: billData.length > 0 ? (
            serverHasMore && !hasMoreItemsLocal ? docs[docs.length - 1] : docs.find(d => d.id === billData[billData.length - 1].id)
          ) : (serverHasMore ? docs[docs.length - 1] : null),
          hasNextPage: serverHasMore || hasMoreItemsLocal,
          hasPrevPage: direction === 'next' ? true : (direction === 'prev' ? (serverHasMore || hasMoreItemsLocal) : false)
        };
        return newHist;
      });

    } catch (error) {
      console.error("Error loading payment data:", error);
      alert("Error loading data: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  /* ================= CLIENT-SIDE PAGINATION (Managed by state) ================= */
  const nextPage = () => {
    if (!hasNextPage) return;
    const nextIdx = currentPageIndex + 1;
    if (pageHistory[nextIdx]) {
      const p = pageHistory[nextIdx];
      setAllRows(p.rows);
      setFirstDoc(p.firstDoc);
      setLastDoc(p.lastDoc);
      setHasNextPage(p.hasNextPage);
      setHasPrevPage(true);
      setCurrentPageIndex(nextIdx);
    } else {
      load('next', lastDoc);
      setCurrentPageIndex(nextIdx);
    }
  };

  const prevPage = () => {
    const prevIdx = currentPageIndex - 1;
    if (prevIdx < 0) return;
    const p = pageHistory[prevIdx];
    if (p) {
      setAllRows(p.rows);
      setFirstDoc(p.firstDoc);
      setLastDoc(p.lastDoc);
      setHasNextPage(p.hasNextPage);
      setHasPrevPage(prevIdx > 0);
      setCurrentPageIndex(prevIdx);
    }
  };

  /* ===== LOAD FACTORIES ON COMPONENT MOUNT ===== */
  useEffect(() => {
    loadFactories();
  }, []);

  /* ===== APPLY FILTERS FUNCTION ===== */
  const applyFilters = () => {
    setAppliedFilters({
      fromDate: fromDate,
      toDate: toDateFilter,
      searchTerm: searchTerm, // Keep for local search within page
      factoryFilter: factoryFilter,
      paymentTypeFilter: paymentTypeFilter
    });
  };

  // Trigger load when filters change or on initial mount
  useEffect(() => {
    if (hasRequestedData) {
      load();
    }
  }, [appliedFilters.factoryFilter, appliedFilters.fromDate, appliedFilters.toDate, hasRequestedData]);

  // Handle manual "Apply Filters" button click
  const handleApplyClick = () => {
    setCurrentPage(1); // Reset to first page
    
    // RESET pagination state properly
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);
    setPageHistory([]);
    setCurrentPageIndex(0);

    setHasRequestedData(true);
    // Update appliedFilters - this will trigger the useEffect which calls load()
    setAppliedFilters({
      fromDate: fromDate,
      toDate: toDateFilter,
      searchTerm: searchTerm,
      factoryFilter: factoryFilter,
      paymentTypeFilter: paymentTypeFilter
    });
  };

  /* ===== CLEAR FILTERS FUNCTION ===== */
  const clearFilters = () => {
    setSearchTerm("");
    setFactoryFilter("");
    setPaymentTypeFilter("");
    setFromDate("");
    setToDateFilter("");

    // RESET pagination state
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);
    setPageHistory([]);
    setCurrentPageIndex(0);

    setAppliedFilters({
      fromDate: "",
      toDate: "",
      searchTerm: "",
      factoryFilter: "",
      paymentTypeFilter: ""
    });
    setAllRows([]);
    setCurrentPage(1);
    setHasRequestedData(false);
    setSelectAll(false);
    setSelectedPayments([]);
  };



  /* ================= CLIENT-SIDE SEARCH + PAGINATION ================= */
  // Apply search filter across ALL records first
  // Search filter across current display rows
  const filteredRowsForSearch = allRows.filter(r => {
    if (searchTerm.trim()) {
      const tokens = searchTerm.toLowerCase().split(/\s+/);
      return tokens.every(t =>
        (r.FactoryName || "").toLowerCase().includes(t) ||
        (r.BillNum || "").toLowerCase().includes(t) ||
        (r.PaymentNumber || "").toLowerCase().includes(t) ||
        (r.BillType || "").toLowerCase().includes(t)
      );
    }
    return true;
  });

  const currentRecords = filteredRowsForSearch;



  /* ===== CHECKBOX HANDLERS ===== */
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedPayments([]);
    } else {
      const allPaymentIds = currentRecords.map(row => row.id);
      setSelectedPayments(allPaymentIds);
    }
    setSelectAll(!selectAll);
  };

  const handleSelectPayment = (paymentId) => {
    if (selectedPayments.includes(paymentId)) {
      setSelectedPayments(selectedPayments.filter(id => id !== paymentId));
    } else {
      setSelectedPayments([...selectedPayments, paymentId]);
    }
  };

  /* ================= EXPORT TO EXCEL ================= */
  const exportToExcel = () => {
    if (currentRecords.length === 0) {
      alert("No data available to export");
      return;
    }

    setExporting(true);
    try {
      // Prepare data for export
      const exportData = currentRecords.map(row => {
        return {
          "Factory Name": row.FactoryName || "",
          "Bill Number": row.BillNum || "",
          "Bill Date": row.BillDate ? formatDate(row.BillDate) : "",
          "Payment Number": row.PaymentNumber || "",
          "Payment Date": row.PaymentDate ? formatDate(row.PaymentDate) : "",
          "Actual Amount": toNum(row.ActualAmount),
          "TDS": toNum(row.Tds),
          "GST": toNum(row.Gst),
          "Payment Received": toNum(row.PaymentReceived),
          "Shortage": toNum(row.Shortage),
          "Total Shortage": toNum(row.TotalShortage),
          "Bill Type": row.BillType || ""
        };
      });

      if (exportData.length === 0) {
        alert("No data to export!");
        setExporting(false);
        return;
      }

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const wscols = [
        { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
        { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add header styling
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Payments Report");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Payments_Report_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${exportData.length} payments to ${fileName}`);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Error exporting to Excel: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ================= EXPORT SELECTED PAYMENTS TO EXCEL ================= */
  const exportSelectedToExcel = () => {
    if (selectedPayments.length === 0) {
      alert("Please select payments to export");
      return;
    }

    setExporting(true);
    try {
      const selectedRows = currentRecords.filter(row => selectedPayments.includes(row.id));

      const exportData = selectedRows.map(row => {
        return {
          "Factory Name": row.FactoryName || "",
          "Bill Number": row.BillNum || "",
          "Bill Date": row.BillDate ? formatDate(row.BillDate) : "",
          "Payment Number": row.PaymentNumber || "",
          "Payment Date": row.PaymentDate ? formatDate(row.PaymentDate) : "",
          "Actual Amount": toNum(row.ActualAmount),
          "TDS": toNum(row.Tds),
          "GST": toNum(row.Gst),
          "Payment Received": toNum(row.PaymentReceived),
          "Shortage": toNum(row.Shortage),
          "Total Shortage": toNum(row.TotalShortage),
          "Bill Type": row.BillType || ""
        };
      });

      // Create worksheet
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths
      const wscols = [
        { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 20 },
        { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 },
        { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add header styling
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Selected Payments");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Selected_Payments_${selectedPayments.length}_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${selectedPayments.length} selected payments to ${fileName}`);
    } catch (error) {
      console.error("Error exporting selected payments:", error);
      alert("Error exporting selected payments: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ===== DELETE/RESET PAYMENT FUNCTION ===== */
  const deleteSelectedPayments = async () => {
    if (selectedPayments.length === 0) {
      alert("Please select payments to reset");
      return;
    }

    setShowConfirmDelete(true);
  };

  const handleEditClick = (payment) => {
    setEditingPayment(payment);
    let pd = "";
    if (payment.PaymentDate && !isNaN(payment.PaymentDate.getTime())) {
      const d = payment.PaymentDate;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      pd = `${yyyy}-${mm}-${dd}`;
    }
    setEditFormData({
      PaymentDate: pd
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingPayment) return;
    setLoading(true);
    try {
      const updateData = { UpdatedAt: serverTimestamp() };
      if (editFormData.PaymentDate) {
        const pd = new Date(editFormData.PaymentDate);
        pd.setHours(12, 0, 0, 0);
        updateData.PaymentRecDate = Timestamp.fromDate(pd);
      }

      await updateDoc(doc(db, "BillTable", editingPayment.id), updateData);

      alert("Payment date updated successfully!");
      setShowEditModal(false);
      setEditingPayment(null);
      await load();
    } catch (error) {
      console.error("Error updating payment:", error);
      alert(`Error updating payment: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = async () => {
    setLoading(true);
    try {
      // Reset payment information for selected bills
      for (const billId of selectedPayments) {
        await updateDoc(doc(db, "BillTable", billId), {
          PaymentReceived: 0,
          ActualAmount: 0,
          Tds: 0,
          Gst: 0,
          PId: null,
          PaymentNumber: null,
          UpdatedAt: serverTimestamp()
        });
      }

      // Reload data
      await load();
      setSelectedPayments([]);
      setSelectAll(false);
      alert(`Successfully reset ${selectedPayments.length} payments`);
    } catch (error) {
      console.error("Error resetting payments:", error);
      alert(`Error resetting payments: ${error.message}`);
    } finally {
      setLoading(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div className="container">
      <h1>Show Payment Report</h1>

      {/* ===== FILTER BAR ===== */}
      <div className="filter-bar">
        <div>
          <input
            type="text"
            placeholder="Search factory, bill no, payment no"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="filter-input"
          />
        </div>

        <div>
          <select
            value={factoryFilter}
            onChange={e => setFactoryFilter(e.target.value)}
            className="filter-select"
            disabled={loadingFactories}
          >
            <option value="">Select Factory</option>
            {loadingFactories ? (
              <option value="" disabled>Loading factories...</option>
            ) : (
              factories.map(f => (
                <option key={f} value={f}>{f}</option>
              ))
            )}
          </select>
          {loadingFactories && (
            <span className="loading-text">Loading factories...</span>
          )}
        </div>

        <div className="date-filter-container">
          <label>From:</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>

        <div className="date-filter-container">
          <label>To:</label>
          <input
            type="date"
            value={toDateFilter}
            onChange={e => setToDateFilter(e.target.value)}
            style={{ padding: 8 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleApplyClick}
            disabled={loading}
            className="filter-button apply-button"
          >
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button
            onClick={clearFilters}
            disabled={loading}
            className="filter-button clear-button"
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div className="export-button-group">
          <button
            onClick={exportToExcel}
            disabled={exporting || currentRecords.length === 0}
            className="export-button export-all-button"
            title="Export all filtered payments to Excel"
          >
            {exporting ? 'Exporting...' : 'Export Visible to Excel'}
          </button>
          <div style={{ fontSize: '0.8em', marginTop: '5px', color: '#666' }}>
            Note: Exports current visible records ({allRows.length})
          </div>

          {isAdmin && selectedPayments.length > 0 && (
            <button
              onClick={exportSelectedToExcel}
              disabled={exporting}
              className="export-button export-selected-button"
              title={`Export ${selectedPayments.length} selected payments to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedPayments.length})`}
            </button>
          )}
        </div>
      </div>

      {/* ===== PAGINATION CONTROLS ===== */}
      {allRows.length > 0 && (
        <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0' }}>
          <button
            onClick={prevPage}
            disabled={loading || !hasPrevPage}
            className="filter-button"
            style={{ opacity: !hasPrevPage ? 0.5 : 1 }}
          >
            Previous
          </button>
          <span>
            Page {currentPageIndex + 1} &nbsp;|&nbsp; Current Page Records: {allRows.length}
            {loading && ' (Loading...)'}
          </span>
          <button
            onClick={nextPage}
            disabled={loading || !hasNextPage}
            className="filter-button"
            style={{ opacity: !hasNextPage ? 0.5 : 1 }}
          >
            Next
          </button>
        </div>
      )}

      {/* ===== DELETE & EXPORT CONTROLS (Only for Admin) ===== */}
      {allRows.length > 0 && isAdmin && (
        <div className={`selection-controls ${selectedPayments.length > 0 ? 'selection-controls-with-selection' : 'selection-controls-without-selection'}`}>
          <div>
            <span style={{ marginRight: 10 }}>
              <input
                type="checkbox"
                checked={selectAll && currentRecords.length > 0}
                onChange={handleSelectAll}
                disabled={currentRecords.length === 0 || loading}
                style={{ marginRight: 5 }}
              />
              Select All ({selectedPayments.length} selected)
            </span>
            <span style={{ color: '#666', fontSize: '14px', marginLeft: '20px' }}>
              Page Payments: {currentRecords.length}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {selectedPayments.length > 0 && (
              <>
                <button
                  onClick={exportSelectedToExcel}
                  disabled={exporting}
                  className="export-button export-selected-button"
                >
                  {exporting ? 'Exporting...' : `Export ${selectedPayments.length} Selected`}
                </button>
                <button
                  onClick={deleteSelectedPayments}
                  disabled={loading}
                  className="filter-button delete-button"
                  style={{ backgroundColor: '#dc3545', fontWeight: 'bold' }}
                >
                  {loading ? 'Resetting...' : `Reset Selected (${selectedPayments.length})`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {loading && <div className="loading-message">Loading payment data...</div>}
      {exporting && <div className="exporting-message">Exporting to Excel...</div>}

      {/* ===== PAYMENT TABLE ===== */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              {/* Only show checkbox column for admin */}
              {isAdmin && (
                <th className="table-header" style={{ textAlign: 'center', width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectAll && currentRecords.length > 0}
                    onChange={handleSelectAll}
                    disabled={currentRecords.length === 0 || loading}
                  />
                </th>
              )}
              <th className="table-header">Factory Name</th>
              <th className="table-header">Bill Number</th>
              <th className="table-header">Bill Date</th>
              <th className="table-header">Payment Number</th>
              <th className="table-header">Payment Date</th>
              <th className="table-header">Actual Amount</th>
              <th className="table-header">TDS</th>
              <th className="table-header">GST</th>
              <th className="table-header">Payment Received</th>
              <th className="table-header">Shortage</th>
              <th className="table-header">Bill Type</th>
              {isAdmin && <th className="table-header">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!loading && currentRecords.length > 0 ? (
              currentRecords.map((r, i) => (
                <tr key={i} className={isAdmin && selectedPayments.includes(r.id) ? 'selected-row' : ''}>
                  {/* Only show checkbox for admin */}
                  {isAdmin && (
                    <td className="table-cell">
                      <input
                        type="checkbox"
                        checked={selectedPayments.includes(r.id)}
                        onChange={() => handleSelectPayment(r.id)}
                        disabled={loading}
                      />
                    </td>
                  )}
                  <td className="table-cell">{r.FactoryName}</td>
                  <td className="table-cell">{r.BillNum}</td>
                  <td className="table-cell">{r.BillDate ? formatDate(r.BillDate) : "N/A"}</td>
                  <td className="table-cell" style={{ fontWeight: r.PaymentNumber ? 'bold' : 'normal' }}>
                    {r.PaymentNumber || "N/A"}
                  </td>
                  <td className="table-cell">{r.PaymentDate ? formatDate(r.PaymentDate) : "N/A"}</td>
                  <td className="table-cell amount-cell">{formatCurrency(r.ActualAmount)}</td>
                  <td className="table-cell amount-cell">{formatCurrency(r.Tds)}</td>
                  <td className="table-cell amount-cell">{formatCurrency(r.Gst)}</td>
                  <td className="table-cell amount-cell currency-positive">
                    {formatCurrency(r.PaymentReceived)}
                  </td>
                  <td className="table-cell amount-cell currency-negative">
                    {formatCurrency(r.Shortage)}
                  </td>
                  <td className="table-cell">{r.BillType || "N/A"}</td>
                  {isAdmin && (
                    <td className="table-cell" style={{ textAlign: "center" }}>
                      <button
                        onClick={() => handleEditClick(r)}
                        style={{ marginRight: 5, padding: "4px 8px", cursor: "pointer", backgroundColor: "#0d6efd", color: "white", border: "none", borderRadius: "4px" }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { setSelectedPayments([r.id]); setShowConfirmDelete(true); }}
                        style={{ padding: "4px 8px", cursor: "pointer", backgroundColor: "#dc3545", color: "white", border: "none", borderRadius: "4px" }}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))
            ) : !loading && (
              <tr>
                <td colSpan={isAdmin ? "13" : "11"} className="no-data-message">
                  {!hasRequestedData ? "Click 'Apply Filters' to load payment records." : (hasNextPage ? "No paid bills found in this server scan chunk. Click 'Next' to scan older records." : "No payment records found. Try adjusting your filters.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== PAGINATION CONTROLS (Managed above) ===== */}

      {/* ===== DELETE CONFIRMATION MODAL (Only for Admin) ===== */}
      {isAdmin && showConfirmDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ marginTop: 0, color: '#cf2f3fff' }}>
              Confirm Reset Payments
            </h3>
            <p style={{ fontSize: '16px', marginBottom: 20 }}>
              Are you sure you want to reset {selectedPayments.length} selected payments?
              This will reset their payment information to zero.
            </p>
            <div className="warning-box">
              <strong>Note:</strong> This action cannot be undone.
            </div>
            <div className="modal-buttons">
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={loading}
                className="modal-button cancel-button"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={loading}
                className="modal-button delete-button"
              >
                {loading ? 'Resetting...' : 'Yes, Reset Payments'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== EDIT MODAL (Only for Admin) ===== */}
      {isAdmin && showEditModal && editingPayment && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: "400px" }}>
            <h3 style={{ marginTop: 0 }}>Edit Payment Details</h3>

            <div style={{ marginBottom: "15px", textAlign: "left" }}>
              <label style={{ display: "block", marginBottom: "5px", fontWeight: "bold" }}>Payment Date:</label>
              <input
                type="date"
                value={editFormData.PaymentDate}
                onChange={(e) => setEditFormData({ ...editFormData, PaymentDate: e.target.value })}
                className="filter-input"
                style={{ width: "100%" }}
              />
            </div>

            <div className="modal-buttons" style={{ marginTop: "20px" }}>
              <button
                onClick={() => setShowEditModal(false)}
                disabled={loading}
                className="modal-button cancel-button"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={loading}
                className="filter-button apply-button"
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ShowPayment;