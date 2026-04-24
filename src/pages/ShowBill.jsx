import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import "./ShowBill.css";

import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  endBefore,
  limitToLast,
  Timestamp,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "firebase/firestore";
import * as XLSX from 'xlsx';
import "./ShowBill.css"; // Import CSS file
 
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ===== SAFE DATE ===== */
const toDate = (v) => {
  if (!v) return null;

  // 1. Firestore timestamp
  if (v.seconds) return new Date(v.seconds * 1000);
  if (typeof v.toDate === "function") return v.toDate();

  // 2. Date object
  if (v instanceof Date) return v;

  // 3. Handle strings
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    // Handle dd-mm-yy, dd/mm/yy, yyyy-mm-dd
    const parts = s.split(/[-/.]/);
    if (parts.length === 3) {
      let d, m, y;
      if (parts[0].length === 4) {
        // yyyy-mm-dd
        [y, m, d] = parts;
      } else {
        // dd-mm-yy or dd-mm-yyyy
        [d, m, y] = parts;
      }

      if (y && y.length === 2) {
        y = (parseInt(y) > 50 ? "19" : "20") + y;
      }

      if (d && m && y) {
        const res = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
        if (!isNaN(res.getTime())) return res;
      }
    } else if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
      // It's probably DD-MM-YYYY without the first check catching it (maybe non-standard delimiter)
      const res = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      if (!isNaN(res.getTime())) return res;
    }

    const dObj = new Date(s);
    return isNaN(dObj.getTime()) ? null : dObj;
  }

  // 4. Handle Excel numbers
  if (typeof v === "number") {
    const res = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(res.getTime()) ? null : res;
  }

  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/* ===== SAFE NUMBER ===== */
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "string") v = v.replace(/,/g, "");
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

/* ===== FORMAT DATE PROPERLY ===== */
const formatDate = (date) => {
  if (!date) return "";

  try {
    if (isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, "0");
    const monthIndex = date.getMonth();
    const month = monthNames[monthIndex];
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
  } catch (error) {
    console.error("Error formatting date:", date, error);
    return "";
  }
};

/* ===== FORMAT FOR SORTING ===== */
const formatDateForSort = (date) => {
  if (!date) return "";
  try {
    if (isNaN(date.getTime())) return "";
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch (error) {
    console.error("Error formatting date for sort:", date, error);
    return "";
  }
};

/* ===== GET DISPATCH MONTH FROM DISPATCH DATES ===== */
const getDispatchMonth = (dispatchRows) => {
  if (!dispatchRows || dispatchRows.length === 0) return "";
  const monthsSet = new Set();

  dispatchRows.forEach(dispatch => {
    const dateStr = dispatch.DispatchDate || dispatch.DispatchDateStr;
    if (dateStr) {
      // Handle both DD-MMM-YYYY and DD-MM-YY formats
      const parts = dateStr.split(/[-/.]/);
      if (parts.length === 3) {
        const monthPart = parts[1];
        // If it's a month name (Jan, Feb...)
        if (monthNames.includes(monthPart)) {
          monthsSet.add(monthPart);
        } else {
          // If it's a number (01, 02...)
          const mIdx = parseInt(monthPart) - 1;
          if (mIdx >= 0 && mIdx < 12) {
            monthsSet.add(monthNames[mIdx]);
          }
        }
      }
    }
  });

  const monthsArray = Array.from(monthsSet).sort((a, b) =>
    monthNames.indexOf(a) - monthNames.indexOf(b)
  );

  return monthsArray.join(', ');
};

const ShowBill = ({ userRole }) => {
  const [rows, setRows] = useState([]);
  const [dispatchRows, setDispatchRows] = useState({});
  const [selectedBillId, setSelectedBillId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedBills, setSelectedBills] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false); // Track if data has been loaded
  const [factories, setFactories] = useState([]); // Separate state for factories
  const [loadingFactories, setLoadingFactories] = useState(true); // Track factory loading

  // Check if user is admin
  const isAdmin = userRole === "admin";

  /* ===== FILTER STATES ===== */
  const [searchBill, setSearchBill] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [factoryFilter, setFactoryFilter] = useState("");

  /* ===== APPLY FILTERS STATE ===== */
  const [appliedFilters, setAppliedFilters] = useState({
    fromDate: "",
    toDate: "",
    factoryFilter: ""
  });

  /* ===== CURSOR PAGINATION STATES ===== */
  const [firstDoc, setFirstDoc] = useState(null);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const BILLS_PER_PAGE = 20;

  /* ===== MEMORY STACK ===== */
  const [pageHistory, setPageHistory] = useState([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  /* ===== QUERY CACHE STATE ===== */
  // (queryCache removed — caused stale data via Vite HMR state preservation)
  const [prefetchCache, setPrefetchCache] = useState({});

  /* ================= LOAD FACTORIES (Optimized) ================= */
  const loadFactories = async (forceRefresh = false) => {
    setLoadingFactories(true);
    try {
      const CACHE_KEY = 'billFactoriesCache';
      const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

      if (!forceRefresh) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          try {
            const { factories, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp < CACHE_EXPIRY_MS) {
              setFactories(factories);
              setLoadingFactories(false);
              return;
            }
          } catch (e) { }
        }
      }

      // Hardcoded high-priority factories to avoid ANY reads if possible
      const defaultFactories = ["JSW", "MANIKGARH", "ULTRATECH", "ACC MARATHA", "AMBUJA", "DALMIA", "ORIENT"];

      // Optional: Fetch from a dedicated small collection if available
      try {
        const factoriesSnap = await getDocs(query(collection(db, "Factories"), limit(100)));
        if (!factoriesSnap.empty) {
          const list = factoriesSnap.docs.map(d => d.data().displayName || d.id).sort();
          setFactories(list);
          localStorage.setItem(CACHE_KEY, JSON.stringify({ factories: list, timestamp: Date.now() }));
        } else {
          // No collection found? Use defaults instead of a heavy BillTable scan
          setFactories(defaultFactories);
        }
      } catch (err) {
        setFactories(defaultFactories);
      }
    } catch (error) {
      console.error("Error loading factories:", error);
    } finally {
      setLoadingFactories(false);
    }
  };

  /* ================= PREFETCH NEXT PAGE ================= */
  const prefetchNextPage = async (cursorDoc) => {
    if (!cursorDoc) return;

    const cacheKey = JSON.stringify({
      filters: appliedFilters,
      direction: "next",
      cursor: cursorDoc.id
    });

    // already prefetched
    if (prefetchCache[cacheKey]) return;

    try {
      let queryConstraints = [];

      queryConstraints.push(orderBy("BillDate", "desc"));

      if (appliedFilters.factoryFilter) {
        queryConstraints.push(
          where("FactoryName", "==", appliedFilters.factoryFilter)
        );
      }

      if (appliedFilters.fromDate) {
        const d = new Date(appliedFilters.fromDate);
        d.setHours(0, 0, 0, 0);
        queryConstraints.push(
          where("BillDate", ">=", Timestamp.fromDate(d))
        );
      }

      if (appliedFilters.toDate) {
        const d = new Date(appliedFilters.toDate);
        d.setHours(23, 59, 59, 999);
        queryConstraints.push(
          where("BillDate", "<=", Timestamp.fromDate(d))
        );
      }

      const q = query(
        collection(db, "BillTable"),
        ...queryConstraints,
        startAfter(cursorDoc),
        limit(BILLS_PER_PAGE + 1)
      );

      const snap = await getDocs(q);

      setPrefetchCache(prev => ({
        ...prev,
        [cacheKey]: snap.docs
      }));

      console.log("⚡ Prefetched next page");
    } catch (err) {
      console.log("Prefetch failed", err);
    }
  };

  /* ================= LOAD DATA WITH CURSOR PAGINATION ================= */
  const load = async (direction = 'initial', cursorDoc = null, targetIndex = 0) => {
    setLoading(true);
    try {
      if (!appliedFilters.fromDate && !appliedFilters.toDate && !appliedFilters.factoryFilter && !searchBill) {
        // Do not clear the UI if they just fat-fingered applying with empty filters
        setLoading(false);
        return;
      }

      // Create cache key
      const cacheKey = JSON.stringify({
        filters: appliedFilters,
        direction,
        cursor: cursorDoc?.id || null
      });



      // Create base query constraints
      let queryConstraints = [];

      // Always add orderBy for table determinism!
      queryConstraints.push(orderBy("BillDate", "desc"));

      // Add factory filter to Firestore query (server-side filtering)
      if (appliedFilters.factoryFilter) {
        queryConstraints.push(where("FactoryName", "==", appliedFilters.factoryFilter));
      }

      // Add date filters
      if (appliedFilters.fromDate) {
        const fromDateObj = new Date(appliedFilters.fromDate);
        fromDateObj.setHours(0, 0, 0, 0);
        queryConstraints.push(where("BillDate", ">=", Timestamp.fromDate(fromDateObj)));
      }

      if (appliedFilters.toDate) {
        const toDateObj = new Date(appliedFilters.toDate);
        toDateObj.setHours(23, 59, 59, 999);
        queryConstraints.push(where("BillDate", "<=", Timestamp.fromDate(toDateObj)));
      }

      console.log("🛠️ BillTable Query Conditions:", queryConstraints.map(c => ({
        field: c._query?.filters?.[0]?.field?.segments?.[0], 
        op: c._query?.filters?.[0]?.op, 
        val: c._query?.filters?.[0]?.value?.internalValue
      })));

      // Build query with cursor pagination
      let billQuery;
      const isFiltering = appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.factoryFilter;

      if (isFiltering) {
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints
        );
      } else if (direction === 'next' && cursorDoc) {
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          startAfter(cursorDoc),
          limit(BILLS_PER_PAGE + 1)
        );
      } else if (direction === 'prev' && cursorDoc) {
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          endBefore(cursorDoc),
          limitToLast(BILLS_PER_PAGE + 1)
        );
      } else {
        // Initial load
        billQuery = query(
          collection(db, "BillTable"),
          ...queryConstraints,
          limit(BILLS_PER_PAGE + 1)
        );
      }

      // PREFETCH CHECK
      let docs;
      const prefetchKey = JSON.stringify({
        filters: appliedFilters,
        direction,
        cursor: cursorDoc?.id || null
      });

      if (prefetchCache[prefetchKey]) {
        console.log("⚡ Using prefetched data");
        docs = prefetchCache[prefetchKey];
      } else {
        const billSnap = await getDocs(billQuery);
        docs = billSnap.docs;
      }

      // Check if there are more pages — works for BOTH filtered and non-filtered
      const hasMore = isFiltering ? false : docs.length > BILLS_PER_PAGE;
      const displayDocs = isFiltering ? docs : (hasMore ? docs.slice(0, BILLS_PER_PAGE) : docs);
      console.log(`📊 BillTable Docs fetched: ${docs.length}, showing: ${displayDocs.length}, hasMore: ${hasMore}`);

      // Detailed logging of each document to catch mismatches
      docs.forEach(d => {
        const data = d.data();
        const rawDate = data.BillDate;
        console.log(`📄 BILL DOC [${d.id}]:`, {
          FactoryName: data.FactoryName,
          BillDate: rawDate?.toDate ? rawDate.toDate().toString() : rawDate,
          BillNum: data.BillNum
        });
      });

      // ===== BULK PREFETCH DISPATCHES TO COMPUTE MISSING FIELDS (Dispatch Month, Amounts) =====
      const billIds = displayDocs.map(d => d.id);
      const dispatchGroups = {};

      if (billIds.length > 0) {
        try {
          // Firestore 'in' query supports max 30 items, so chunk the array
          for (let i = 0; i < billIds.length; i += 30) {
            const chunk = billIds.slice(i, i + 30);
            const dispQ = query(
              collection(db, "TblDispatch"),
              where("BillID", "in", chunk)
            );
            const dispSnap = await getDocs(dispQ);
            
            dispSnap.forEach(dDoc => {
              const data = dDoc.data();
              const bId = data.BillID;
              if (!dispatchGroups[bId]) dispatchGroups[bId] = [];
              
              // Format DispatchDate so getDispatchMonth can read it correctly
              const dDateObj = toDate(data.DispatchDate);
              const formattedDate = formatDate(dDateObj);
              
              dispatchGroups[bId].push({
                ...data,
                DispatchDateStr: formattedDate // Use this for getDispatchMonth
              });
            });
          }
        } catch (err) {
          console.error("Error batch fetching dispatches:", err);
        }
      }

      // Update pagination cursors
      if (displayDocs.length > 0) {
        setFirstDoc(displayDocs[0]);
        setLastDoc(displayDocs[displayDocs.length - 1]);

        // ✅ FIXED: pagination now works for filtered results too
        if (direction === 'next') {
          setHasNextPage(hasMore);
          setHasPrevPage(true);
        } else if (direction === 'prev') {
          setHasPrevPage(hasMore);
          setHasNextPage(true);
        } else {
          // initial load (filtered or not)
          setHasNextPage(hasMore);
          setHasPrevPage(false);
        }
      } else {
        setFirstDoc(null);
        setLastDoc(null);
        setHasNextPage(false);
        setHasPrevPage(false);
      }

      // Build the resulting list directly from BillTable properties (no frontend joins)
      const result = displayDocs.map(b => {
        const bill = b.data();
        const billDateObj = toDate(bill.BillDate);
        const bId = b.id;

        // Get pre-fetched dispatches
        const dispatches = dispatchGroups[bId] || [];

        // 1. Resolve Dispatch Month
        // Pass objects with DispatchDate mapped to the expected string format for getDispatchMonth
        const dispatchMonthComputed = getDispatchMonth(
          dispatches.map(d => ({ ...d, DispatchDate: d.DispatchDateStr }))
        );

        // 2. Resolve Amounts
        let lrQty = bill.LRQuantity;
        let billQty = toNum(bill.BillQuantity);
        let taxAmt = toNum(bill.TaxableAmount);
        let finalPrc = toNum(bill.FinalPrice);
        let actualAmt = toNum(bill.ActualAmount);
        let tdsAmt = toNum(bill.TDS || bill.Tds);
        let gstAmt = toNum(bill.GST || bill.Gst);

        // If core amount (taxAmt) is missing, but we have dispatches, calculate them dynamically!
        if (!taxAmt && dispatches.length > 0) {
          lrQty = dispatches.length;
          billQty = 0;
          taxAmt = 0;
          let totalFinalPrice = 0;
          let fpValidCount = 0;

          dispatches.forEach(d => {
            const dq = toNum(d.DispatchQuantity);
            const up = toNum(d.UnitPrice);
            const fp = toNum(d.FinalPrice);

            billQty += dq;
            const t = dq * up;
            taxAmt += t;
            totalFinalPrice += fp;

            if (fp > 0 && (t === 0 || fp <= t)) {
              fpValidCount++;
            }
          });

          const allHaveFP = fpValidCount === dispatches.length;
          const base = allHaveFP ? totalFinalPrice : taxAmt;
          if (taxAmt === 0 && base > 0) taxAmt = base;

          finalPrc = (totalFinalPrice === taxAmt) ? 0 : totalFinalPrice;
          gstAmt = base * 0.18;
          tdsAmt = base * 0.00984;
          actualAmt = base + gstAmt;
        }

        // 3. Fallback Month (if no dispatch dates, use Bill Date)
        const billMonthFallback = billDateObj ? monthNames[billDateObj.getMonth()] : "N/A";

        return {
          BillID: bId,
          "Dispatch Month": (bill.DispatchMonth && bill.DispatchMonth !== "N/A") 
            ? bill.DispatchMonth 
            : (dispatchMonthComputed || billMonthFallback), 
          "Factory Name": bill.FactoryName || "",
          "Bill Num": bill.BillNum || "",
          "LR Quantity": lrQty || 0,
          "Bill Quantity": toNum(billQty || 0).toFixed(2),
          "Taxable Amount": toNum(taxAmt || 0).toFixed(2),
          "Final Price": toNum(finalPrc || 0).toFixed(2),
          "Actual Amount": toNum(actualAmt || 0).toFixed(2),
          "TDS": toNum(tdsAmt || 0).toFixed(2),
          "GST": toNum(gstAmt || 0).toFixed(2),
          
          "Bill Date": formatDate(billDateObj),
          "Bill Type": bill.BillType || "",
          BillDateObj: billDateObj,
          BillDateSortKey: formatDateForSort(billDateObj)
        };
      }).filter(Boolean);

      setRows(result);
      setDataLoaded(true);

      // Cache current page locally so "back" is instant
      setPageHistory(prev => {
        const newHistory = [...prev];
        newHistory[targetIndex] = {
          rows: result,
          firstDoc: displayDocs.length > 0 ? displayDocs[0] : null,
          lastDoc: displayDocs.length > 0 ? displayDocs[displayDocs.length - 1] : null,
          hasNextPage: hasMore,
          hasPrevPage: direction !== 'initial'
        };
        return newHistory;
      });

      setCurrentPageIndex(targetIndex);

      setSelectedBills([]);
      setSelectAll(false);
    } catch (error) {
      console.error("Error loading data:", error);
      
      if (error.message && error.message.includes("index")) {
        const indexUrlMatch = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
        const indexUrl = indexUrlMatch ? indexUrlMatch[0] : null;

        if (indexUrl) {
          if (window.confirm("⚠️ Composite Index Required\n\nFirebase needs a composite index for this query. Would you like to open the Firebase Console to create it now?")) {
            window.open(indexUrl, "_blank");
          }
        } else {
          alert("⚠️ Composite Index Required\n\nFirebase needs a composite index for this query. Check the browser console for the auto-generated index creation link from Firebase.");
        }
      } else {
        alert(`Error loading data: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };


  /* ===== LOAD FACTORIES ON COMPONENT MOUNT ===== */
  useEffect(() => {
    loadFactories();
  }, []);

  /* ===== LOAD WHEN APPLIED FILTERS CHANGE ===== */
  useEffect(() => {
    // Only load data if appliedFilters have changed and data hasn't been loaded yet
    // OR if we're applying new filters
    if (appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.factoryFilter || appliedFilters.timestamp) {
      load();
    }
  }, [appliedFilters]);

  /* ===== APPLY FILTERS FUNCTION ===== */
  const applyFilters = () => {
    // RESET pagination state
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);
    setSelectedBillId(null);
    setPageHistory([]);
    setCurrentPageIndex(0);

    // Mark that we want to load data
    setAppliedFilters({
      ...appliedFilters,
      fromDate: fromDate,
      toDate: toDateFilter,
      factoryFilter: factoryFilter,
      timestamp: Date.now() // to force trigger useEffect
    });
  };

  /* ===== CLEAR FILTERS FUNCTION ===== */
  const clearFilters = () => {
    setSearchBill("");
    setFactoryFilter("");
    setFromDate("");
    setToDateFilter("");

    // RESET pagination state
    setFirstDoc(null);
    setLastDoc(null);
    setHasNextPage(false);
    setHasPrevPage(false);
    setSelectedBillId(null);
    setPageHistory([]);
    setCurrentPageIndex(0);

    setAppliedFilters({
      fromDate: "",
      toDate: "",
      factoryFilter: ""
    });
    // Clear data when filters are cleared
    setRows([]);
    setDispatchRows({});
    setDataLoaded(false);
    setSelectedBills([]);
  };

  /* ===== PAGINATION NAVIGATION ===== */
  const nextPage = () => {
    if (!hasNextPage) return;

    const nextIndex = currentPageIndex + 1;

    // already loaded → instant
    if (pageHistory[nextIndex]) {
      const p = pageHistory[nextIndex];

      setRows(p.rows);
      setFirstDoc(p.firstDoc);
      setLastDoc(p.lastDoc);
      setHasNextPage(p.hasNextPage);
      setHasPrevPage(true);

      setCurrentPageIndex(nextIndex);
      return;
    }

    // otherwise fetch normally
    load("next", lastDoc, nextIndex);
  };

  const prevPage = () => {
    const prevIndex = currentPageIndex - 1;
    if (prevIndex < 0) return;

    const p = pageHistory[prevIndex];
    if (!p) return;

    setRows(p.rows);
    setFirstDoc(p.firstDoc);
    setLastDoc(p.lastDoc);
    setHasNextPage(p.hasNextPage);
    setHasPrevPage(prevIndex > 0);

    setCurrentPageIndex(prevIndex);
  };

  /* ================= APPLY SEARCH FILTER (local) ================= */
  const filteredRows = useMemo(() => {
    let data = [...rows];

    // Search filter (only client-side filter remaining)
    if (searchBill.trim()) {
      const tokens = searchBill.toLowerCase().split(/\s+/);
      data = data.filter(r =>
        tokens.every(t =>
          (r["Factory Name"] || "").toLowerCase().includes(t) ||
          (r["Bill Num"] || "").toLowerCase().includes(t) ||
          (r["Bill Date"] || "").toLowerCase().includes(t) ||
          (r["Dispatch Month"] || "").toLowerCase().includes(t)
        )
      );
    }

    return data;
  }, [rows, searchBill]);

  // Display rows (all filtered rows are shown, pagination is server-side)
  const displayRows = selectedBillId
    ? filteredRows.filter(r => r.BillID === selectedBillId)
    : filteredRows;

  /* ================= ON-DEMAND FETCH DISPATCHES ================= */
  const fetchDispatchForBill = async (billId) => {
    // If we already loaded it, don't re-fetch
    if (dispatchRows[billId]) {
      setSelectedBillId(billId === selectedBillId ? null : billId);
      return;
    }

    // Toggle off if clicking same bill
    if (selectedBillId === billId) {
      setSelectedBillId(null);
      return;
    }

    setLoading(true);
    try {
      const dispQuery = query(
        collection(db, "TblDispatch"),
        where("BillID", "==", billId)
      );
      const dispSnap = await getDocs(dispQuery);

      const loadedDispatches = dispSnap.docs.map(d => {
        const r = d.data();
        const dispatchDateObj = toDate(r.DispatchDate || r.dispatchDate || r.Date || r.dispatch_date);
        return {
          id: d.id,
          ChallanNo: r.ChallanNo || "",
          DispatchDate: formatDate(dispatchDateObj),
          DispatchDateSortKey: formatDateForSort(dispatchDateObj),
          Quantity: toNum(r.DispatchQuantity),
          UnitPrice: toNum(r.UnitPrice),
          FinalPrice: toNum(r.FinalPrice),
          VehicleNo: r.VehicleNo || r.TruckNo || r.vehicleNo || r.vehicleno || r.vehicle_no || r.Vehicle_No || "",
          LRNo: r.LRNo || r.lrNo || r.lrno || r.lr_no || r.LR_No || "",
          DeliveryNum: r.DeliveryNum || r.deliveryNum || r.delivery_num || r.delivery_no || r.Delivery_No || ""
        };
      });

      setDispatchRows(prev => ({
        ...prev,
        [billId]: loadedDispatches
      }));
      setSelectedBillId(billId);
    } catch (e) {
      console.error("Error fetching dispatches for bill", e);
      alert("Failed to load dispatch details for this bill.");
    } finally {
      setLoading(false);
    }
  };

  // Sort dispatch rows by date
  const getSortedDispatchRows = (billId) => {
    if (!dispatchRows[billId]) return [];
    return [...dispatchRows[billId]].sort((a, b) => {
      return new Date(a.DispatchDateSortKey) - new Date(b.DispatchDateSortKey);
    });
  };

  /* ===== CHECKBOX HANDLERS ===== */
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedBills([]);
    } else {
      const allBillIds = displayRows.map(row => row.BillID);
      setSelectedBills(allBillIds);
    }
    setSelectAll(!selectAll);
  };

  const handleSelectBill = (billId) => {
    if (selectedBills.includes(billId)) {
      setSelectedBills(selectedBills.filter(id => id !== billId));
    } else {
      setSelectedBills([...selectedBills, billId]);
    }
  };

  /* ================= EXPORT TO EXCEL ================= */
  const exportToExcel = () => {
    if (!dataLoaded || filteredRows.length === 0) {
      alert("No data to export! Please apply filters first.");
      return;
    }

    setExporting(true);
    try {
      // Prepare data for export
      const exportData = filteredRows.map(row => {
        return {
          "Dispatch Month": row["Dispatch Month"] || "",
          "Factory Name": row["Factory Name"] || "",
          "Bill Num": row["Bill Num"] || "",
          "LR Quantity": toNum(row["LR Quantity"]),
          "Bill Quantity": toNum(row["Bill Quantity"]),
          "Taxable Amount": toNum(row["Taxable Amount"]),
          "Final Price": toNum(row["Final Price"]),
          "Actual Amount": toNum(row["Actual Amount"]),
          "TDS": toNum(row["TDS"]),
          "GST": toNum(row["GST"]),
          "Bill Date": row["Bill Date"] || "",
          "Bill Type": row["Bill Type"] || ""
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
        { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      // Add styling
      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      // Format number columns
      const numberColumns = ["LR Quantity", "Bill Quantity", "Taxable Amount", "Final Price",
        "Actual Amount", "TDS", "GST"];
      const colIndexMap = {};
      Object.keys(exportData[0]).forEach((key, index) => {
        colIndexMap[key] = index;
      });

      for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        numberColumns.forEach(colName => {
          const colIndex = colIndexMap[colName];
          if (colIndex !== undefined) {
            const cellAddress = XLSX.utils.encode_col(colIndex) + (R + 1);
            if (ws[cellAddress]) {
              ws[cellAddress].z = '#,##0.00';
            }
          }
        });
      }

      // Create workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bills Report");

      // Generate filename
      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Bills_Report_${dateStr}.xlsx`;

      // Export file
      XLSX.writeFile(wb, fileName);

      alert(`Exported ${exportData.length} bills to ${fileName}`);
    } catch (error) {
      console.error("Error exporting to Excel:", error);
      alert("Error exporting to Excel: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ================= EXPORT SELECTED BILLS TO EXCEL ================= */
  const exportSelectedToExcel = () => {
    if (selectedBills.length === 0) {
      alert("Please select bills to export");
      return;
    }

    setExporting(true);
    try {
      const allFilteredRows = filteredRows;
      const selectedRows = allFilteredRows.filter(row => selectedBills.includes(row.BillID));

      const exportData = selectedRows.map(row => {
        return {
          "Dispatch Month": row["Dispatch Month"] || "",
          "Factory Name": row["Factory Name"] || "",
          "Bill Num": row["Bill Num"] || "",
          "LR Quantity": toNum(row["LR Quantity"]),
          "Bill Quantity": toNum(row["Bill Quantity"]),
          "Taxable Amount": toNum(row["Taxable Amount"]),
          "Final Price": toNum(row["Final Price"]),
          "Actual Amount": toNum(row["Actual Amount"]),
          "TDS": toNum(row["TDS"]),
          "GST": toNum(row["GST"]),
          "Bill Date": row["Bill Date"] || "",
          "Bill Type": row["Bill Type"] || ""
        };
      });

      const ws = XLSX.utils.json_to_sheet(exportData);

      const wscols = [
        { wch: 15 }, { wch: 20 }, { wch: 20 }, { wch: 12 },
        { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }
      ];
      ws['!cols'] = wscols;

      const range = XLSX.utils.decode_range(ws['!ref']);
      for (let C = range.s.c; C <= range.e.c; ++C) {
        const address = XLSX.utils.encode_col(C) + "1";
        if (!ws[address]) continue;
        ws[address].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "E0E0E0" } }
        };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Selected Bills");

      const dateStr = new Date().toISOString().split('T')[0];
      const fileName = `Selected_Bills_${selectedBills.length}_${dateStr}.xlsx`;

      XLSX.writeFile(wb, fileName);

      alert(`Exported ${selectedBills.length} selected bills to ${fileName}`);
    } catch (error) {
      console.error("Error exporting selected bills:", error);
      alert("Error exporting selected bills: " + error.message);
    } finally {
      setExporting(false);
    }
  };

  /* ===== DELETE BILL FUNCTION ===== */
  const deleteSelectedBills = async () => {
    if (selectedBills.length === 0) {
      alert("Please select bills to delete");
      return;
    }

    setShowConfirmDelete(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      for (const billId of selectedBills) {
        const dispatchQuery = query(
          collection(db, "TblDispatch"),
          where("BillID", "==", billId)
        );

        const dispatchSnapshot = await getDocs(dispatchQuery);

        for (const dispatchDoc of dispatchSnapshot.docs) {
          await updateDoc(doc(db, "TblDispatch", dispatchDoc.id), {
            BillID: "",
            BillNum: "",
            UpdatedAt: serverTimestamp()
          });
        }

        await deleteDoc(doc(db, "BillTable", billId));
      }

      await load();
      alert(`Successfully deleted ${selectedBills.length} bill(s)`);
    } catch (error) {
      console.error("Error deleting bills:", error);
      alert(`Error deleting bills: ${error.message}`);
    } finally {
      setDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  return (
    <div className="bill-report-container">
      <h2 className="bill-report-title">Bill Report</h2>

      {/* Show initial state message */}
      {!dataLoaded && rows.length === 0 && !loading && (
        <div className="no-data-container">
          <p>No data loaded. Please apply filters to load bills.</p>
        </div>
      )}

      {/* ===== FILTER BAR ===== */}
      <div className="filter-bar">
        <div>
          <input
            type="text"
            placeholder="Search factory, bill no, date, month"
            value={searchBill}
            onChange={e => setSearchBill(e.target.value)}
            className="filter-input filter-input-search"
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
          {loadingFactories && <span className="loading-text">Loading factories...</span>}
        </div>

        <div className="flex items-center gap-5">
          <label className="filter-label">From:</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="filter-input-date"
          />
        </div>

        <div className="flex items-center gap-5">
          <label className="filter-label">To:</label>
          <input
            type="date"
            value={toDateFilter}
            onChange={e => setToDateFilter(e.target.value)}
            className="filter-input-date"
          />
        </div>

        <div className="filter-button-group">
          <button
            onClick={applyFilters}
            disabled={loading}
            className="filter-button filter-button-apply"
          >
            {loading ? 'Loading...' : 'Apply Filters'}
          </button>
          <button
            onClick={clearFilters}
            disabled={loading}
            className="filter-button filter-button-clear"
          >
            Clear Filters
          </button>
        </div>

        {/* ===== EXPORT BUTTONS ===== */}
        <div className="export-button-group">
          <button
            onClick={exportToExcel}
            disabled={exporting || !dataLoaded || filteredRows.length === 0}
            className="export-button export-button-all"
            title="Export all filtered bills to Excel"
          >
            {exporting ? 'Exporting...' : 'Export All to Excel'}
          </button>

          {isAdmin && selectedBills.length > 0 && (
            <button
              onClick={exportSelectedToExcel}
              disabled={exporting}
              className="export-button export-button-selected"
              title={`Export ${selectedBills.length} selected bills to Excel`}
            >
              {exporting ? 'Exporting...' : `Export Selected (${selectedBills.length})`}
            </button>
          )}
        </div>

        {/* Applied filters indicator */}
        {(appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.searchBill || appliedFilters.factoryFilter) && (
          <div className="applied-filters">
            {appliedFilters.fromDate || appliedFilters.toDate ? (
              <span>
                Date: {appliedFilters.fromDate || 'Any'} to {appliedFilters.toDate || 'Any'}
              </span>
            ) : null}
            {appliedFilters.searchBill && (
              <span>Search: "{appliedFilters.searchBill}"</span>
            )}
            {appliedFilters.factoryFilter && (
              <span>Factory: {appliedFilters.factoryFilter}</span>
            )}
          </div>
        )}
      </div>

      {/* Show loading state non-destructively */}
      {loading && (
        <div style={{ color: "#666", fontStyle: "italic", marginBottom: "10px" }}>
          Updating data...
        </div>
      )}
      {exporting && <div className="exporting-container">Exporting to Excel...</div>}

      {/* Only show table controls and data if data is loaded */}
      {dataLoaded && rows.length > 0 && (
        <>
          {/* ===== CURSOR PAGINATION CONTROLS ===== */}
          <div className="pagination-controls">
            <div className="pagination-nav">
              <button
                onClick={prevPage}
                disabled={!hasPrevPage || loading}
                className="pagination-button pagination-button-prev"
              >
                ← Previous
              </button>

              <span className="pagination-info">
                Showing {displayRows.length} bills {(appliedFilters.fromDate || appliedFilters.toDate || appliedFilters.factoryFilter) ? "(All filtered results)" : `(max ${BILLS_PER_PAGE} per page)`}
              </span>

              <button
                onClick={nextPage}
                disabled={!hasNextPage || loading}
                className="pagination-button pagination-button-next"
              >
                Next →
              </button>
            </div>
          </div>

          {/* ===== DELETE & EXPORT CONTROLS (Only for Admin) ===== */}
          {isAdmin && (
            <div className={`selection-controls ${selectedBills.length > 0 ? 'selection-controls-with-selection' : 'selection-controls-without-selection'}`}>
              <div className="selection-info">
                <span>
                  <input
                    type="checkbox"
                    checked={selectAll && displayRows.length > 0}
                    onChange={handleSelectAll}
                    disabled={displayRows.length === 0 || loading}
                    className="selection-checkbox"
                  />
                  Select All ({selectedBills.length} selected)
                </span>
                <span className="page-bills-info">
                  Page Bills: {displayRows.length}
                </span>
              </div>

              <div className="selection-actions">
                {selectedBills.length > 0 && (
                  <>
                    <button
                      onClick={exportSelectedToExcel}
                      disabled={exporting}
                      className="export-button export-button-selected"
                    >
                      {exporting ? 'Exporting...' : `Export ${selectedBills.length} Selected`}
                    </button>
                    <button
                      onClick={deleteSelectedBills}
                      disabled={deleting}
                      className="delete-button"
                    >
                      {deleting ? 'Deleting...' : `Delete Selected (${selectedBills.length})`}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ===== BILL TABLE ===== */}
          <div className="table-container">
            <table border="1" className="bill-table">
              <thead>
                <tr>
                  {/* Only show checkbox column for admin */}
                  {isAdmin && (
                    <th className="checkbox-column">
                      <input
                        type="checkbox"
                        checked={selectAll && displayRows.length > 0}
                        onChange={handleSelectAll}
                        disabled={displayRows.length === 0 || loading}
                      />
                    </th>
                  )}
                  <th>Dispatch Month</th>
                  <th>Factory Name</th>
                  <th>Bill Num</th>
                  <th>LR Quantity</th>
                  <th>Bill Quantity</th>
                  <th>Taxable Amount</th>
                  <th>Final Price</th>
                  <th>Actual Amount</th>
                  <th>TDS</th>
                  <th>GST</th>
                  <th>Bill Date</th>
                  <th>Bill Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length > 0 ? (
                  displayRows.map((r, i) => (
                    <tr key={i} className={isAdmin && selectedBills.includes(r.BillID) ? 'selected-row' : ''}>
                      {/* Only show checkbox for admin */}
                      {isAdmin && (
                        <td className="checkbox-column">
                          <input
                            type="checkbox"
                            checked={selectedBills.includes(r.BillID)}
                            onChange={() => handleSelectBill(r.BillID)}
                            disabled={loading}
                          />
                        </td>
                      )}
                      <td style={{ fontWeight: r["Dispatch Month"] ? 'normal' : 'lighter' }}>
                        {r["Dispatch Month"] || "N/A"}
                      </td>
                      <td>{r["Factory Name"]}</td>
                      <td>{r["Bill Num"]}</td>
                      <td>{r["LR Quantity"]}</td>
                      <td>{r["Bill Quantity"]}</td>
                      <td>{r["Taxable Amount"]}</td>
                      <td>{r["Final Price"]}</td>
                      <td>{r["Actual Amount"]}</td>
                      <td>{r["TDS"]}</td>
                      <td>{r["GST"]}</td>
                      <td>{r["Bill Date"]}</td>
                      <td>{r["Bill Type"]}</td>
                      <td>
                        <button
                          onClick={() => fetchDispatchForBill(r.BillID)}
                          className={`view-button ${selectedBillId === r.BillID ? 'view-button-active' : 'view-button-inactive'}`}
                        >
                          {selectedBillId === r.BillID ? "Hide" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isAdmin ? "15" : "14"} className="no-data-container">
                      No bills found with current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </>
      )}

      {/* ===== DISPATCH DETAILS ===== */}
      {selectedBillId && dispatchRows[selectedBillId] && (
        <>
          <h3 className="dispatch-title">
            Dispatch Details for Bill: {selectedBillId}
            {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"] && (
              <span className="dispatch-months">
                Dispatch Month(s): {rows.find(r => r.BillID === selectedBillId)?.["Dispatch Month"]}
              </span>
            )}
          </h3>
          <div className="table-container">
            <table border="1" className="bill-table">
              <thead>
                <tr>
                  <th>Challan No</th>
                  <th>Dispatch Date</th>
                  <th>Vehicle No</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Final Price</th>
                  <th>LR No</th>
                  <th>Delivery No</th>
                </tr>
              </thead>
              <tbody>
                {getSortedDispatchRows(selectedBillId).map((d, i) => (
                  <tr key={i}>
                    <td>{d.ChallanNo}</td>
                    <td>{d.DispatchDate}</td>
                    <td>{d.VehicleNo}</td>
                    <td>{d.Quantity.toFixed(2)}</td>
                    <td>{d.UnitPrice.toFixed(2)}</td>
                    <td>{d.FinalPrice.toFixed(2)}</td>
                    <td>{d.LRNo}</td>
                    <td>{d.DeliveryNum}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===== CONFIRM DELETE MODAL (Only for Admin) ===== */}
      {isAdmin && showConfirmDelete && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">Confirm Delete</h3>
            <p>
              Are you sure you want to delete <strong>{selectedBills.length}</strong> selected bill(s)?
            </p>
            <p className="modal-note">
              <strong>Note:</strong> This will remove the bill from BillTable but keep the dispatch records (only removing their BillID link).
            </p>

            <div className="modal-actions">
              <button
                onClick={() => setShowConfirmDelete(false)}
                disabled={deleting}
                className="modal-button modal-button-cancel"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="modal-button modal-button-delete"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShowBill;