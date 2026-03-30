
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, limit, orderBy } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";

const Dashboard = () => {
    const { userRole } = useAuth();
    const [summaryData, setSummaryData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [totalStats, setTotalStats] = useState({ totalQty: 0, billQty: 0, balance: 0 });

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    useEffect(() => {
        const fetchDashboardData = async () => {
            setLoading(true);
            try {
                // Optimized "One-Read" Summary Fetch
                // We only fetch the summary documents for the current year
                const q = query(
                    collection(db, "TblDispatchMonthly"),
                    where("year", "==", currentYear),
                    orderBy("month", "desc"),
                    limit(100)
                );

                const snap = await getDocs(q);
                const rows = snap.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                setSummaryData(rows);

                // Calculate stats for current month
                const currentMonthDocs = rows.filter(r => r.month === currentMonth);
                const stats = currentMonthDocs.reduce((acc, curr) => ({
                    totalQty: acc.totalQty + (Number(curr.totalQty) || 0),
                    billQty: acc.billQty + (Number(curr.billQty) || 0)
                }), { totalQty: 0, billQty: 0 });

                setTotalStats({
                    totalQty: stats.totalQty,
                    billQty: stats.billQty,
                    balance: stats.totalQty - stats.billQty
                });

            } catch (err) {
                console.error("Dashboard fetch error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, [currentYear, currentMonth]);

    const fmt = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

    if (loading) {
        return (
            <div style={dashboardStyles.loaderContainer}>
                <div style={dashboardStyles.loader}></div>
                <p>Loading Dashboard...</p>
                <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    return (
        <div style={dashboardStyles.container}>
            <header style={dashboardStyles.header}>
                <div>
                    <h1 style={dashboardStyles.title}>Welcome back!</h1>
                    <p style={dashboardStyles.subtitle}>High-performance overview for {new Date().toLocaleString('default', { month: 'long' })}, {currentYear}</p>
                </div>
                <div style={dashboardStyles.badge}>
                    {userRole === 'admin' ? '🛡️ Admin Access' : '🚚 Dispatcher Access'}
                </div>
            </header>

            {/* Quick Stats Cards */}
            <div style={dashboardStyles.statsGrid}>
                <StatCard 
                    title="Current Month Total" 
                    value={fmt(totalStats.totalQty)} 
                    unit="MT" 
                    color="#4f46e5" 
                    icon="🚚" 
                />
                <StatCard 
                    title="Current Month Billed" 
                    value={fmt(totalStats.billQty)} 
                    unit="MT" 
                    color="#10b981" 
                    icon="🧾" 
                />
                <StatCard 
                    title="Pending Balance" 
                    value={fmt(totalStats.balance)} 
                    unit="MT" 
                    color="#f59e0b" 
                    icon="⏳" 
                />
            </div>

            <div style={dashboardStyles.contentGrid}>
                {/* Recent Factory Performance */}
                <div style={dashboardStyles.card}>
                    <div style={dashboardStyles.cardHeader}>
                        <h3 style={dashboardStyles.cardTitle}>Recent Factory Activities</h3>
                        <Link to="/monthly-qty-report" style={dashboardStyles.link}>Full Report ›</Link>
                    </div>
                    <div style={dashboardStyles.tableWrapper}>
                        <table style={dashboardStyles.table}>
                            <thead>
                                <tr>
                                    <th style={dashboardStyles.th}>Factory</th>
                                    <th style={dashboardStyles.th}>Month</th>
                                    <th style={dashboardStyles.thRight}>Total Qty</th>
                                    <th style={dashboardStyles.thRight}>Billed Qty</th>
                                    <th style={dashboardStyles.thRight}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {summaryData.length === 0 ? (
                                    <tr><td colSpan="5" style={{...dashboardStyles.td, textAlign: 'center', padding: '40px'}}>No summary data found for {currentYear}</td></tr>
                                ) : summaryData.slice(0, 6).map((row, i) => (
                                    <tr key={row.id} style={i % 2 === 0 ? {} : dashboardStyles.altRow}>
                                        <td style={dashboardStyles.td}><strong>{row.factory}</strong></td>
                                        <td style={dashboardStyles.td}>{new Date(2000, row.month - 1).toLocaleString('default', { month: 'short' })}</td>
                                        <td style={dashboardStyles.tdRight}>{fmt(row.totalQty)}</td>
                                        <td style={dashboardStyles.tdRight}>{fmt(row.billQty)}</td>
                                        <td style={dashboardStyles.tdRight}>
                                            <span style={dashboardStyles.statusBadge(row.totalQty - row.billQty === 0)}>
                                                {row.totalQty - row.billQty === 0 ? 'Completed' : 'Pending'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Quick Actions */}
                <div style={dashboardStyles.sideColumn}>
                    <div style={dashboardStyles.card}>
                         <h3 style={dashboardStyles.cardTitle}>Quick Actions</h3>
                         <div style={dashboardStyles.actionGrid}>
                            <ActionLink to="/upload-dispatch" icon="📤" label="Upload" color="#4f46e5" />
                            <ActionLink to="/show-dispatch" icon="📦" label="Dispatch" color="#0ea5e9" />
                            {userRole === 'admin' ? (
                                <>
                                    <ActionLink to="/payment-upload" icon="💳" label="Payments" color="#10b981" />
                                    <ActionLink to="/dispatch-export" icon="⬇️" label="Export" color="#6366f1" />
                                </>
                            ) : (
                                <>
                                    <ActionLink to="/bag-short-update" icon="🎒" label="Bag update" color="#f59e0b" />
                                    <ActionLink to="/factories" icon="🏭" label="Factories" color="#64748b" />
                                </>
                            )}
                         </div>
                    </div>

                    <div style={{...dashboardStyles.card, marginTop: '20px', backgroundColor: '#f0f9ff', borderColor: '#bae6fd'}}>
                        <div style={{display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px'}}>
                            <span style={{fontSize: '18px'}}>💡</span>
                            <h4 style={{margin: 0, color: '#0369a1', fontSize: '14px'}}>Read Cost Saved</h4>
                        </div>
                        <p style={{margin: 0, fontSize: '12px', color: '#075985', lineHeight: '1.5'}}>
                            This dashboard uses pre-calculated summaries. Loading this view costs <strong>1 read</strong> per month document, instead of thousands of reads.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ title, value, unit, color, icon }) => (
    <div style={{...dashboardStyles.card, borderTop: `4px solid ${color}`, display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
        <div style={dashboardStyles.statHeader}>
            <span style={dashboardStyles.statIcon}>{icon}</span>
            <span style={dashboardStyles.statTitle}>{title}</span>
        </div>
        <div style={dashboardStyles.statBody}>
            <span style={dashboardStyles.statValue}>{value}</span>
            <span style={dashboardStyles.statUnit}>{unit}</span>
        </div>
    </div>
);

const ActionLink = ({ to, icon, label, color }) => (
    <Link to={to} style={dashboardStyles.actionLink}>
        <div style={{...dashboardStyles.actionIcon, backgroundColor: color + '15', color}}>{icon}</div>
        <div style={dashboardStyles.actionLabel}>{label}</div>
    </Link>
);

const dashboardStyles = {
    container: {
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '10px 0'
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '30px'
    },
    title: {
        fontSize: '28px',
        fontWeight: '700',
        color: '#111827',
        margin: '0 0 4px 0'
    },
    subtitle: {
        fontSize: '15px',
        color: '#6b7280',
        margin: 0
    },
    badge: {
        background: '#fff',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: '600',
        color: '#374151',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        border: '1px solid #e5e7eb'
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '20px',
        marginBottom: '30px'
    },
    card: {
        background: '#fff',
        borderRadius: '12px',
        padding: '20px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        border: '1px solid #e5e7eb'
    },
    statHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '12px'
    },
    statIcon: {
        fontSize: '20px'
    },
    statTitle: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: '0.025em'
    },
    statBody: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px'
    },
    statValue: {
        fontSize: '32px',
        fontWeight: '700',
        color: '#111827'
    },
    statUnit: {
        fontSize: '14px',
        fontWeight: '500',
        color: '#9ca3af'
    },
    contentGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: '20px',
        alignItems: 'start'
    },
    cardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
    },
    cardTitle: {
        fontSize: '18px',
        fontWeight: '700',
        color: '#111827',
        margin: 0
    },
    link: {
        fontSize: '14px',
        fontWeight: '600',
        color: '#4f46e5',
        textDecoration: 'none'
    },
    tableWrapper: {
        overflowX: 'auto'
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse'
    },
    th: {
        textAlign: 'left',
        padding: '12px 15px',
        fontSize: '12px',
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
        borderBottom: '1px solid #f3f4f6'
    },
    thRight: {
        textAlign: 'right',
        padding: '12px 15px',
        fontSize: '12px',
        fontWeight: '600',
        color: '#6b7280',
        textTransform: 'uppercase',
        borderBottom: '1px solid #f3f4f6'
    },
    td: {
        padding: '14px 15px',
        fontSize: '14px',
        color: '#374151',
        borderBottom: '1px solid #f3f4f6'
    },
    tdRight: {
        textAlign: 'right',
        padding: '14px 15px',
        fontSize: '14px',
        color: '#374151',
        borderBottom: '1px solid #f3f4f6'
    },
    altRow: {
        backgroundColor: '#fafafa'
    },
    statusBadge: (isComplete) => ({
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '11px',
        fontWeight: '600',
        background: isComplete ? '#dcfce7' : '#fef3c7',
        color: isComplete ? '#166534' : '#92400e'
    }),
    sideColumn: {
        display: 'flex',
        flexDirection: 'column'
    },
    actionGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginTop: '15px'
    },
    actionLink: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 10px',
        borderRadius: '10px',
        textDecoration: 'none',
        border: '1px solid #f3f4f6',
        transition: 'all 0.2s ease',
        background: '#fff'
    },
    actionIcon: {
        width: '40px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        fontSize: '20px',
        marginBottom: '8px'
    },
    actionLabel: {
        fontSize: '12px',
        fontWeight: '600',
        color: '#4b5563'
    },
    loaderContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '300px',
        gap: '15px'
    },
    loader: {
        width: '40px',
        height: '40px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #4f46e5',
        borderRadius: '50%'
    }
};

export default Dashboard;
