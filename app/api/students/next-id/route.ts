
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/postgres';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const cohortId = searchParams.get('cohortId');

        if (!cohortId) {
            return NextResponse.json({ error: 'cohortId is required' }, { status: 400 });
        }

        // Get maximum existing sequence suffix for this cohort ID
        const result = await sql`
            SELECT COALESCE(
                MAX(
                    CASE 
                        WHEN LENGTH(unique_id) > LENGTH(unique_cohort_id) 
                             AND SUBSTRING(unique_id FROM LENGTH(unique_cohort_id) + 1) ~ '^[0-9]+$'
                        THEN SUBSTRING(unique_id FROM LENGTH(unique_cohort_id) + 1)::integer
                        ELSE 0 
                    END
                ), 0
            ) as max_seq 
            FROM students 
            WHERE unique_cohort_id = ${cohortId}
        `;

        const nextSeq = parseInt(result[0].max_seq || 0) + 1;
        
        return NextResponse.json({ nextSeq });
    } catch (error) {
        console.error('[API/NextId] Error:', error);
        return NextResponse.json({ error: 'Failed to generate next sequence' }, { status: 500 });
    }
}
