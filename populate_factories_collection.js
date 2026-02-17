// populate_factories_collection.js
// One-time migration script to create and populate the Factories collection
// This optimizes factory loading from 100-5000 reads down to 3-5 reads

import {
    collection,
    getDocs,
    query,
    where,
    setDoc,
    doc,
    serverTimestamp
} from 'firebase/firestore';
import { db } from './src/firebaseConfig.js';

async function populateFactoriesCollection() {
    console.log('🏭 Starting Factories collection population...\n');

    try {
        // Step 1: Get all unique factory names from BillTable with payments
        console.log('📊 Step 1: Scanning BillTable for unique factories...');

        const billQuery = query(
            collection(db, 'BillTable'),
            where('PaymentReceived', '>', 0)
        );

        const billSnap = await getDocs(billQuery);
        console.log(`   Found ${billSnap.docs.length} bills with payments\n`);

        // Extract unique factory names
        const factorySet = new Set();
        billSnap.docs.forEach(billDoc => {
            const data = billDoc.data();
            if (data.FactoryName) {
                factorySet.add(data.FactoryName);
            }
        });

        const uniqueFactories = Array.from(factorySet).sort();
        console.log(`   Unique factories found: ${uniqueFactories.length}`);
        uniqueFactories.forEach(f => console.log(`     - ${f}`));
        console.log('');

        if (uniqueFactories.length === 0) {
            console.log('⚠️  No factories found with payments. Nothing to populate.');
            return;
        }

        // Step 2: Create Factories collection documents
        console.log('📝 Step 2: Creating Factories collection...\n');

        let created = 0;
        let failed = 0;

        for (const factoryName of uniqueFactories) {
            try {
                const factoryDocRef = doc(db, 'Factories', factoryName);

                await setDoc(factoryDocRef, {
                    displayName: factoryName,
                    hasPayments: true,
                    createdAt: serverTimestamp(),
                    lastUpdated: serverTimestamp()
                });

                created++;
                console.log(`   ✅ Created: ${factoryName}`);

            } catch (error) {
                console.error(`   ❌ Failed to create ${factoryName}:`, error.message);
                failed++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📈 Migration Summary:');
        console.log('='.repeat(60));
        console.log(`✅ Created:  ${created}`);
        console.log(`❌ Failed:   ${failed}`);
        console.log(`📊 Total:    ${uniqueFactories.length}`);
        console.log('='.repeat(60));

        // Step 3: Verify the new collection
        console.log('\n🔍 Step 3: Verifying Factories collection...\n');

        const factoriesQuery = query(
            collection(db, 'Factories'),
            where('hasPayments', '==', true)
        );

        const factoriesSnap = await getDocs(factoriesQuery);
        console.log(`   Found ${factoriesSnap.docs.length} factories in Factories collection`);
        console.log(`   Firestore reads: ${factoriesSnap.docs.length} (vs ${billSnap.docs.length} before optimization)`);

        const reduction = ((1 - factoriesSnap.docs.length / billSnap.docs.length) * 100).toFixed(1);
        console.log(`   \n   🎉 Read reduction: ${reduction}% (${billSnap.docs.length} → ${factoriesSnap.docs.length} reads)`);

        console.log('\n✨ Migration completed successfully!');
        console.log('💡 Future factory loads will use only 3-5 reads instead of hundreds/thousands.\n');

    } catch (error) {
        console.error('💥 Migration failed:', error);
        throw error;
    }
}

// Run the migration
console.log('⚠️  WARNING: This script will create a new Factories collection');
console.log('⚠️  Make sure your Firebase credentials are configured correctly\n');

populateFactoriesCollection()
    .then(() => {
        console.log('✅ All done!');
        console.log('💡 You can now safely delete this script.\n');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Migration failed with error:', error);
        process.exit(1);
    });
