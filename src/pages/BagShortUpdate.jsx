import React, { useState } from "react";
import { db } from "../firebaseConfig";
import {
    collection,
    query,
    where,
    getDocs,
    updateDoc,
    doc
} from "firebase/firestore";

const FACTORY_OPTIONS = [
    "ACC MARATHA",
    "AMBUJA",
    "DALMIA",
    "MP BIRLA",
    "ORIENT",
    "MANIGARH",
    "ULTRATECH",
    "JSW"
];

const formatDate = (dateVal) => {
    if (!dateVal) return "—";
    const d = dateVal.seconds
        ? new Date(dateVal.seconds * 1000)
        : new Date(dateVal);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
};

const BagShortUpdate = () => {
    const [factory, setFactory] = useState("");
    const [challanNo, setChallanNo] = useState("");
    const [dispatchDate, setDispatchDate] = useState("");
    const [truckNo, setTruckNo] = useState("");

    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [record, setRecord] = useState(null);       // matched Firestore doc
    const [bagShort, setBagShort] = useState("");      // new BagShort input
    const [bagShortUnit, setBagShortUnit] = useState("Bag"); // "Bag" or "KG"
    const [searchError, setSearchError] = useState("");
    const [successMsg, setSuccessMsg] = useState("");

    /* ─────────────────────────── SEARCH ─────────────────────────── */
    // Challan is optional when BOTH Dispatch Date and Truck No are provided
    const challanRequired = !(dispatchDate && truckNo.trim());

    // Returns midnight-start and end-of-day Dates for a YYYY-MM-DD string
    const getDateRange = (dateStr) => {
        const start = new Date(dateStr);
        start.setHours(0, 0, 0, 0);
        const end = new Date(dateStr);
        end.setHours(23, 59, 59, 999);
        return { start, end };
    };

    const handleSearch = async (e) => {
        e.preventDefault();
        setRecord(null);
        setSearchError("");
        setSuccessMsg("");
        setBagShort("");

        if (!factory) {
            setSearchError("❌ Please select a Factory.");
            return;
        }

        if (challanRequired && !challanNo.trim()) {
            setSearchError("❌ Please enter a Challan Number, or provide both Dispatch Date and Truck No to search without it.");
            return;
        }

        setSearching(true);
        try {
            let snap;

            if (challanNo.trim()) {
                // Search by Factory + Challan (most precise)
                const q = query(
                    collection(db, "TblDispatch"),
                    where("FactoryName", "==", factory),
                    where("ChallanNo", "==", challanNo.trim().toUpperCase())
                );
                snap = await getDocs(q);

                if (snap.empty) {
                    setSearchError(
                        `⚠️ No record found for Challan "${challanNo.trim().toUpperCase()}" in factory "${factory}".`
                    );
                    setSearching(false);
                    return;
                }
            } else {
                // Challan not provided — push filters to Firestore (no client-side scan)
                const constraints = [
                    where("FactoryName", "==", factory)
                ];

                // Truck filter — Firestore-side
                if (truckNo.trim()) {
                    constraints.push(
                        where("VehicleNo", "==", truckNo.trim().toUpperCase())
                    );
                }

                // Date filter — Firestore-side range on Timestamp field
                if (dispatchDate) {
                    const { start, end } = getDateRange(dispatchDate);
                    constraints.push(where("DispatchDate", ">=", start));
                    constraints.push(where("DispatchDate", "<=", end));
                }

                const q = query(collection(db, "TblDispatch"), ...constraints);
                snap = await getDocs(q);

                if (snap.empty) {
                    setSearchError(`⚠️ No records found for factory "${factory}" with the given Truck No / Date.`);
                    setSearching(false);
                    return;
                }
            }

            // Firestore already filtered — just map docs directly
            const filtered = snap.docs.map((d) => ({ id: d.id, ...d.data() }));


            if (filtered.length === 0) {
                setSearchError(
                    challanNo.trim()
                        ? "⚠️ Record found for Challan, but it doesn't match the provided Truck No or Dispatch Date."
                        : "⚠️ No records match the provided Dispatch Date and Truck No for the selected factory."
                );
            } else {
                const data = filtered[0];
                setRecord(data);
                setBagShort(
                    data.BagShort !== undefined && data.BagShort !== null
                        ? String(data.BagShort)
                        : ""
                );
                setBagShortUnit(data.BagShortUnit || "Bag");
            }
        } catch (err) {
            console.error("Search error:", err);
            setSearchError("❌ Search failed: " + err.message);
        } finally {
            setSearching(false);
        }
    };


    /* ─────────────────────────── SAVE ─────────────────────────── */
    const handleSave = async () => {
        if (!record) return;

        const numVal = parseFloat(bagShort);
        if (bagShort.trim() === "" || isNaN(numVal)) {
            setSearchError("❌ Please enter a valid number for Bag Short (e.g. 5 or 2.5).");
            return;
        }

        setSaving(true);
        setSearchError("");
        setSuccessMsg("");
        try {
            const updatedAt = new Date();
            await updateDoc(doc(db, "TblDispatch", record.id), {
                BagShort: numVal,
                BagShortUnit: bagShortUnit,
                BagShortUpdatedDate: updatedAt
            });

            setRecord((prev) => ({ ...prev, BagShort: numVal, BagShortUnit: bagShortUnit, BagShortUpdatedDate: updatedAt }));
            setSuccessMsg(
                `✅ Bag Short updated to ${numVal} ${bagShortUnit}(s) for Challan "${record.ChallanNo}" (${factory}).`
            );
        } catch (err) {
            console.error("Update error:", err);
            setSearchError("❌ Update failed: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    /* ─────────────────────────── RESET ─────────────────────────── */
    /* ─────────────────────────── RESET ─────────────────────────── */
    const handleReset = () => {
        setFactory("");
        setChallanNo("");
        setDispatchDate("");
        setTruckNo("");
        setRecord(null);
        setBagShort("");
        setBagShortUnit("Bag");
        setSearchError("");
        setSuccessMsg("");
    };


    /* ─────────────────────────── UI ─────────────────────────── */
    return (
        <div style={styles.page}>
            <h2 style={styles.heading}>🎒 Update Bag Short</h2>
            <p style={styles.subtext}>
                Search by <strong>Factory</strong> + <strong>Challan Number</strong>, or leave Challan blank
                and provide both <strong>Dispatch Date</strong> and <strong>Truck No</strong>.
            </p>

            {/* ── SEARCH FORM ── */}
            <form onSubmit={handleSearch} style={styles.card}>
                <div style={styles.row}>
                    {/* Factory */}
                    <div style={styles.field}>
                        <label style={styles.label}>🏭 Factory *</label>
                        <select
                            value={factory}
                            onChange={(e) => { setFactory(e.target.value); setRecord(null); setSuccessMsg(""); setSearchError(""); }}
                            style={styles.select}
                            required
                        >
                            <option value="">-- Select Factory --</option>
                            {FACTORY_OPTIONS.map((f) => (
                                <option key={f} value={f}>{f}</option>
                            ))}
                        </select>
                    </div>

                    {/* Challan Number */}
                    <div style={styles.field}>
                        <label style={styles.label}>
                            🔢 Challan Number{" "}
                            {challanRequired
                                ? <span style={{ color: "#ef4444" }}>*</span>
                                : <span style={{ color: "#6b7280", fontWeight: 400, fontSize: 12 }}>(Optional)</span>
                            }
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. 6988560862"
                            value={challanNo}
                            onChange={(e) => { setChallanNo(e.target.value); setRecord(null); setSuccessMsg(""); setSearchError(""); }}
                            style={styles.input}
                            required={challanRequired}
                        />
                    </div>

                    {/* Dispatch Date */}
                    <div style={styles.field}>
                        <label style={styles.label}>📅 Dispatch Date (Optional)</label>
                        <input
                            type="date"
                            value={dispatchDate}
                            onChange={(e) => { setDispatchDate(e.target.value); setRecord(null); setSuccessMsg(""); setSearchError(""); }}
                            style={styles.input}
                        />
                    </div>

                    {/* Truck No */}
                    <div style={styles.field}>
                        <label style={styles.label}>🚛 Truck No (Optional)</label>
                        <input
                            type="text"
                            placeholder="e.g. MH12AB1234"
                            value={truckNo}
                            onChange={(e) => { setTruckNo(e.target.value); setRecord(null); setSuccessMsg(""); setSearchError(""); }}
                            style={styles.input}
                        />
                    </div>
                </div>


                <div style={styles.btnRow}>
                    <button
                        type="submit"
                        disabled={searching}
                        style={{ ...styles.btn, backgroundColor: "#2563eb" }}
                    >
                        {searching ? "⏳ Searching..." : "🔍 Search"}
                    </button>
                    <button
                        type="button"
                        onClick={handleReset}
                        style={{ ...styles.btn, backgroundColor: "#6b7280" }}
                    >
                        ↺ Reset
                    </button>
                </div>
            </form>

            {/* ── ERROR / SUCCESS MESSAGES ── */}
            {searchError && <div style={styles.errorBox}>{searchError}</div>}
            {successMsg && <div style={styles.successBox}>{successMsg}</div>}

            {/* ── RECORD DETAIL + EDIT ── */}
            {record && (
                <div style={styles.card}>
                    <h3 style={styles.sectionHeading}>📋 Record Found</h3>

                    <table style={styles.table}>
                        <tbody>
                            {[
                                ["Challan No", record.ChallanNo],
                                ["Factory", record.FactoryName],
                                ["Dispatch Date", formatDate(record.DispatchDate)],
                                ["Vehicle No", record.VehicleNo || "—"],
                                ["Destination", record.Destination || "—"],
                                ["Party Name", record.PartyName || "—"],
                                ["Dispatch Qty", record.DispatchQuantity ?? "—"],
                                ["Advance", record.Advance ?? "—"],
                                ["Diesel", record.Diesel ?? "—"],
                                ["Current Bag Short", record.BagShort !== undefined && record.BagShort !== null
                                    ? `${record.BagShort} ${record.BagShortUnit || "Bag"}`
                                    : "Not set"],
                                ["Last Updated", record.BagShortUpdatedDate
                                    ? formatDate(record.BagShortUpdatedDate)
                                    : "—"],
                            ].map(([label, value]) => (
                                <tr key={label}>
                                    <td style={styles.tdLabel}>{label}</td>
                                    <td style={styles.tdValue}>{value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* ── BAG SHORT INPUT ── */}
                    <div style={styles.bagShortSection}>
                        <label style={styles.label}>
                            🎒 New Bag Short Value{" "}
                            <span style={{ color: "#6b7280", fontSize: 13 }}>
                                (integer or decimal, e.g. 5 or 2.5)
                            </span>
                        </label>
                        <div style={styles.row}>
                            {/* Quantity input */}
                            <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="Enter Bag Short..."
                                value={bagShort}
                                onChange={(e) => { setBagShort(e.target.value); setSuccessMsg(""); setSearchError(""); }}
                                style={{ ...styles.input, maxWidth: 180 }}
                            />

                            {/* Bag / KG toggle */}
                            <div style={styles.unitToggle}>
                                {["Bag", "KG"].map((unit) => (
                                    <button
                                        key={unit}
                                        type="button"
                                        onClick={() => { setBagShortUnit(unit); setSuccessMsg(""); setSearchError(""); }}
                                        style={{
                                            ...styles.unitBtn,
                                            backgroundColor: bagShortUnit === unit ? "#2563eb" : "#e5e7eb",
                                            color: bagShortUnit === unit ? "#fff" : "#374151",
                                        }}
                                    >
                                        {unit}
                                    </button>
                                ))}
                            </div>

                            <button
                                onClick={handleSave}
                                disabled={saving || bagShort.trim() === ""}
                                style={{
                                    ...styles.btn,
                                    backgroundColor:
                                        saving || bagShort.trim() === "" ? "#9ca3af" : "#16a34a",
                                    cursor:
                                        saving || bagShort.trim() === "" ? "not-allowed" : "pointer"
                                }}
                            >
                                {saving ? "⏳ Saving..." : "💾 Save Bag Short"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ─────────────────────────── STYLES ─────────────────────────── */
const styles = {
    page: {
        maxWidth: 720,
        margin: "0 auto",
        padding: "20px 16px"
    },
    heading: {
        fontSize: 24,
        fontWeight: 700,
        marginBottom: 6,
        color: "#1f2937"
    },
    subtext: {
        fontSize: 14,
        color: "#6b7280",
        marginBottom: 24
    },
    card: {
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: 24,
        marginBottom: 20,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)"
    },
    sectionHeading: {
        fontSize: 17,
        fontWeight: 600,
        marginBottom: 16,
        color: "#1f2937"
    },
    row: {
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        alignItems: "flex-end"
    },
    field: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 200
    },
    label: {
        fontSize: 13,
        fontWeight: 600,
        color: "#374151",
        marginBottom: 6
    },
    input: {
        padding: "9px 12px",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        fontSize: 14,
        outline: "none",
        width: "100%",
        boxSizing: "border-box"
    },
    select: {
        padding: "9px 12px",
        border: "1px solid #d1d5db",
        borderRadius: 6,
        fontSize: 14,
        background: "#fff",
        width: "100%",
        boxSizing: "border-box"
    },
    btnRow: {
        display: "flex",
        gap: 12,
        marginTop: 18,
        flexWrap: "wrap"
    },
    btn: {
        padding: "9px 20px",
        color: "#fff",
        border: "none",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer"
    },
    errorBox: {
        background: "#fef2f2",
        border: "1px solid #fca5a5",
        color: "#b91c1c",
        padding: "12px 16px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 14
    },
    successBox: {
        background: "#f0fdf4",
        border: "1px solid #86efac",
        color: "#15803d",
        padding: "12px 16px",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 14
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        marginBottom: 24,
        fontSize: 14
    },
    tdLabel: {
        padding: "8px 12px",
        fontWeight: 600,
        color: "#374151",
        background: "#f9fafb",
        border: "1px solid #e5e7eb",
        width: "40%"
    },
    tdValue: {
        padding: "8px 12px",
        color: "#1f2937",
        border: "1px solid #e5e7eb"
    },
    bagShortSection: {
        borderTop: "1px solid #e5e7eb",
        paddingTop: 20
    },
    unitToggle: {
        display: "flex",
        gap: 0,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid #d1d5db",
        flexShrink: 0
    },
    unitBtn: {
        padding: "9px 18px",
        border: "none",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.15s, color 0.15s"
    }
};

export default BagShortUpdate;
