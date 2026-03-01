import { db } from "../firebaseConfig";
import { doc, setDoc, increment } from "firebase/firestore";

/**
 * Updates the TblDispatchMonthly summary document when a dispatch is added.
 *
 * Document ID format: "{FactoryName}_{year}_{month}"
 * e.g.  "JSW_2026_3"
 *
 * @param {object} dispatch  - the same DTO that was just saved to TblDispatch
 *   Required fields:
 *     dispatch.DispatchDate       - JS Date object
 *     dispatch.FactoryName        - string  (e.g. "JSW")
 *     dispatch.DispatchQuantity   - number
 *     dispatch.UnitPrice          - number  (0 = not yet billed)
 */
export async function updateMonthlySummary(dispatch) {
    try {
        const date = dispatch.DispatchDate instanceof Date
            ? dispatch.DispatchDate
            : new Date(dispatch.DispatchDate);

        if (isNaN(date.getTime())) {
            console.warn("updateMonthlySummary: invalid date, skipping summary update");
            return;
        }

        const year = date.getFullYear();
        const month = date.getMonth() + 1;           // 1-based
        const factory = (dispatch.FactoryName || "UNKNOWN").toUpperCase().trim();

        // Stable document ID — one doc per factory per month
        const docId = `${factory}_${year}_${month}`;
        const ref = doc(db, "TblDispatchMonthly", docId);

        const qty = Number(dispatch.DispatchQuantity) || 0;
        const isBilled = (Number(dispatch.UnitPrice) > 0) ||
            dispatch.BillStatus === true ||
            dispatch.IsBilled === true ||
            dispatch.Billed === true;

        await setDoc(ref, {
            year,
            month,
            factory,
            totalQty: increment(qty),
            billQty: increment(isBilled ? qty : 0),
            // balance is derived:  totalQty - billQty  (computed in the UI)
        }, { merge: true });

        console.log(`📊 Monthly summary updated → ${docId}`);
    } catch (err) {
        // Never block the main upload flow
        console.error("updateMonthlySummary error (non-fatal):", err);
    }
}
