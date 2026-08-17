/**
 * Landing Page
 * 
 * Full-width layout with cached forms, manual sync buttons, and subtle loading.
 * Mobile-friendly with bottom navigation.
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getPendingSubmissionCount,
  hasSchoolsCache,
  getCachedAssessments,
  getAllCachedForms,
  getLastSchoolsSyncTime,
  getPendingSubmissions,
  getAllUnsyncedSubmissions,
  type CachedAssessment,
  type CachedForm,
  type OfflineSubmission
} from '@/lib/db';
import {
  initSyncListeners,
  triggerSync,
  forceSyncSchools,
  forceSyncAssessments,
  forceSyncStudents,
  onSyncStatusChange,
  checkActualConnectivity,
  type SyncStatus
} from '@/lib/sync';
import { getTeacherSession, logoutTeacher, isLeadOrPMRole, type TeacherSession } from '@/lib/auth';

interface Assessment {
  assessment_id: number;
  title: string;
  description: string | null;
  class_grade: number;
  language?: string;
  languages?: string[];
  group_identifier?: string;
  academic_year?: string;
  type?: string;
  subtype?: string;
  phase?: string;
  intervention?: string;
  assessment_type?: string;
}

function getAssessmentType(a: Assessment): 'formative' | 'summative' | 'other' {
  if (a.type) {
    const t = a.type.toLowerCase().trim();
    if (t === 'formative' || t === 'summative') return t;
  }
  const title = (a.title || '').toLowerCase();
  if (title.includes('formative')) return 'formative';
  if (title.includes('summative')) return 'summative';
  return 'other';
}

function getAssessmentSubtype(a: Assessment): string {
  if (a.subtype) {
    return a.subtype.toUpperCase().trim();
  }
  const title = a.title || '';
  if (/\bIP\b/i.test(title)) return 'IP';
  if (/\bEOM\b/i.test(title)) return 'EOM';
  if (/\bbaseline\b/i.test(title)) return 'BASELINE';
  if (/\bendline\b/i.test(title)) return 'ENDLINE';
  return '';
}

function getAssessmentPhase(a: Assessment): string {
  if (a.phase) {
    return a.phase.trim();
  }
  const title = a.title || '';
  const match = title.match(/\b(Phase\s*\d+)\b/i);
  if (match) {
    return match[1].replace(/phase\s*/i, 'Phase ');
  }
  return '';
}

function getAssessmentYear(a: Assessment): string {
  if (a.academic_year) {
    return a.academic_year.trim();
  }
  const title = a.title || '';
  const match = title.match(/\b(20\d{2}-\d{2})\b/);
  if (match) {
    return match[1];
  }
  return '';
}

export default function HomePage() {
  const router = useRouter();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [cachedForms, setCachedForms] = useState<CachedForm[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = useState<OfflineSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingAssessments, setSyncingAssessments] = useState(false);
  const [syncingSchools, setSyncingSchools] = useState(false);
  const [syncingStudents, setSyncingStudents] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [hasCache, setHasCache] = useState(false);
  const [lastSchoolsSync, setLastSchoolsSync] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [selectedClass, setSelectedClass] = useState<number | 'all'>('all');
  const [selectedType, setSelectedType] = useState<'all' | 'formative' | 'summative'>('all');
  const [selectedSubtype, setSelectedSubtype] = useState<string>('all');
  const [selectedPhase, setSelectedPhase] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [teacherSession, setTeacherSession] = useState<TeacherSession | null>(null);
  const [syncQueueExpanded, setSyncQueueExpanded] = useState(false);

  const isLeadOrPM = isLeadOrPMRole(teacherSession?.role);

  // Prefetch and pre-cache HTML and RSC payloads for all cached forms when online
  useEffect(() => {
    if (online && cachedForms.length > 0) {
      const preCache = async () => {
        for (const form of cachedForms) {
          const languages = form.formData.languages && form.formData.languages.length > 0
            ? form.formData.languages
            : ['English'];
          for (const lang of languages) {
            const url = `/forms/${form.formId}?lang=${lang}`;
            try {
              // 1. Prefetch via Next.js router
              router.prefetch(url);

              // 2. Programmatically fetch the HTML document to ensure it's in the Service Worker cache
              fetch(url, { priority: 'low' } as any).catch(() => {});

              // 3. Programmatically fetch the RSC payload to ensure it's in the Service Worker cache
              fetch(url, {
                headers: { 'RSC': '1' },
                priority: 'low'
              } as any).catch(() => {});
            } catch (e) {
              console.warn('[Pre-Cache] Failed to pre-cache page assets:', url, e);
            }
          }
        }
      };
      preCache();
    }
  }, [online, cachedForms, router]);

  // Programmatically pre-cache main app shell HTML and RSC payloads when online
  useEffect(() => {
    if (online) {
      const shellRoutes = ['/', '/login', '/grading'];
      shellRoutes.forEach(url => {
        try {
          // Fetch HTML document
          fetch(url, { priority: 'low' } as any).catch(() => {});
          // Fetch RSC payload
          fetch(url, {
            headers: { 'RSC': '1' },
            priority: 'low'
          } as any).catch(() => {});
        } catch (e) {
          console.warn('[Pre-Cache] Failed to pre-cache shell path:', url, e);
        }
      });
    }
  }, [online]);

  // Load cached forms
  const loadCachedForms = useCallback(async () => {
    const forms = await getAllCachedForms();
    setCachedForms(forms);
  }, []);

  // Load pending submissions
  const loadPendingSubmissions = useCallback(async () => {
    const unsynced = await getAllUnsyncedSubmissions();
    setPendingSubmissions(unsynced);
    setPendingCount(unsynced.length);
  }, []);

  // Load cached student count
  const loadStudentCount = useCallback(async () => {
    try {
      const { db } = await import('@/lib/db');
      const count = await db.cachedStudents.count();
      setStudentCount(count);
    } catch (e) {
      console.error('Failed to load student count:', e);
    }
  }, []);

  // Load assessments (from cache first, then API if online)
  const loadAssessments = useCallback(async () => {
    // Always load all from cache first
    const cached = await getCachedAssessments();
    if (cached.length > 0) {
      setAssessments(cached);
    }

    // If online, fetch fresh data from API
    if (online) {
      try {
        // Use forceSyncAssessments so it goes through the cache and pruning pipeline
        const data = await forceSyncAssessments();
        setAssessments(data);
        await loadCachedForms();
      } catch (err) {
        console.error('Failed to sync assessments on load:', err);
      }
    }
  }, [loadCachedForms, online]);

  // Initial load
  useEffect(() => {
    initSyncListeners();
    checkActualConnectivity().then(setOnline);
    setMounted(true);

    const handleNetworkChange = () => {
      checkActualConnectivity().then(setOnline);
    };

    window.addEventListener('online', handleNetworkChange);
    window.addEventListener('offline', handleNetworkChange);

    // Periodic recheck every 15 seconds
    const connectivityInterval = setInterval(() => {
      checkActualConnectivity().then(setOnline);
    }, 15000);

    // Listen for sync status changes
    const unsubscribe = onSyncStatusChange((status) => {
      setSyncStatus(status);
      if (!status.isSyncing) {
        loadPendingSubmissions();
        loadCachedForms();
        loadStudentCount();
      }
    });

    async function loadData() {
      setLoading(true);

      // Fetch teacher session immediately so UI updates right away
      getTeacherSession().then(sess => setTeacherSession(sess)).catch(() => {});

      try {
        const [cached, lastSync] = await Promise.all([
          hasSchoolsCache(),
          getLastSchoolsSyncTime()
        ]);
        setHasCache(cached);
        setLastSchoolsSync(lastSync);
      } catch (err) {
        console.error('Failed to load cache meta:', err);
      }

      await loadCachedForms();
      await loadAssessments();
      await loadPendingSubmissions();
      await loadStudentCount();

      const actuallyOnline = await checkActualConnectivity();
      if (actuallyOnline) {
        triggerSync().catch(console.error);
      }

      setLoading(false);
    }

    loadData();

    return () => {
      window.removeEventListener('online', handleNetworkChange);
      window.removeEventListener('offline', handleNetworkChange);
      clearInterval(connectivityInterval);
      unsubscribe();
    };
  }, [loadCachedForms, loadAssessments, loadPendingSubmissions]);

  // Manual sync handlers
  const handleSyncSchools = async () => {
    if (!online) return;
    setSyncingSchools(true);
    try {
      await forceSyncSchools();
      setHasCache(true);
      setLastSchoolsSync(new Date());
    } catch (err) {
      setError('Failed to sync schools');
    } finally {
      setSyncingSchools(false);
    }
  };

  const handleSyncAssessments = async () => {
    if (!online) return;
    setSyncingAssessments(true);
    try {
      const data = await forceSyncAssessments();
      setAssessments(data);
      await loadCachedForms();
    } catch (err) {
      setError('Failed to sync assessments');
    } finally {
      setSyncingAssessments(false);
    }
  };

  const handleSyncStudents = async () => {
    if (!online) return;
    setSyncingStudents(true);
    try {
      await forceSyncStudents();
      await loadStudentCount();
    } catch (err) {
      setError('Failed to sync students');
    } finally {
      setSyncingStudents(false);
    }
  };

  const handleSyncAll = async () => {
    if (!online) return;
    await triggerSync();
    await loadPendingSubmissions();
    await loadStudentCount();
  };

  // Get cached form IDs for highlighting
  const cachedFormIds = new Set(cachedForms.map(f => f.formId));

  // Derive available academic years from assessments and cached forms
  const availableYears = useMemo(() => {
    const yearsSet = new Set<string>();
    assessments.forEach(a => {
      const yr = getAssessmentYear(a);
      if (yr) yearsSet.add(yr);
    });
    cachedForms.forEach(f => {
      const yr = getAssessmentYear({
        assessment_id: f.formId,
        title: f.formData.title,
        description: null,
        class_grade: f.formData.class_grade || 0,
        academic_year: (f.formData as any).academic_year
      });
      if (yr) yearsSet.add(yr);
    });

    const standardYears = ['2026-27', '2025-26', '2024-25'];
    standardYears.forEach(y => yearsSet.add(y));

    return Array.from(yearsSet).sort().reverse();
  }, [assessments, cachedForms]);

  // Derive available phases for summative assessments
  const availablePhases = useMemo(() => {
    const phaseSet = new Set<string>(['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5']);
    assessments.forEach(a => {
      const p = getAssessmentPhase(a);
      if (p) phaseSet.add(p);
    });
    return Array.from(phaseSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [assessments]);

  // Filter assessments: when offline, only show cached ones
  // If assessments is empty but we have cached forms, derive from cached forms
  let displayedAssessments: Assessment[];
  if (!online) {
    const filteredFromAssessments = assessments.filter(a => cachedFormIds.has(a.assessment_id));
    if (filteredFromAssessments.length > 0) {
      displayedAssessments = filteredFromAssessments;
    } else {
      // Derive from cached forms if assessments cache is empty
      displayedAssessments = cachedForms.map(f => ({
        assessment_id: f.formId,
        title: f.formData.title,
        description: f.formData.description || null,
        class_grade: f.formData.class_grade || 0,
        language: undefined,
        languages: f.formData.languages || ['English'],
        group_identifier: undefined,
        academic_year: (f.formData as any).academic_year || undefined,
        type: (f.formData as any).type || undefined,
        subtype: (f.formData as any).subtype || undefined,
        phase: (f.formData as any).phase || undefined,
        assessment_type: (f.formData as any).intervention || undefined
      }));
    }
  } else {
    displayedAssessments = assessments;
  }

  // 1. Apply class filter
  if (selectedClass !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => a.class_grade === selectedClass);
  }

  // 2. Apply Assessment Type filter (Formative / Summative)
  if (selectedType !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => getAssessmentType(a) === selectedType);
  }

  // 3. Apply Formative Subtype filter (IP / EOM)
  if (selectedType === 'formative' && selectedSubtype !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => getAssessmentSubtype(a) === selectedSubtype);
  }

  // 4. Apply Summative Phase filter
  if (selectedType === 'summative' && selectedPhase !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => getAssessmentPhase(a).toLowerCase() === selectedPhase.toLowerCase());
  }

  // 5. Apply Academic Year filter
  if (selectedYear !== 'all') {
    displayedAssessments = displayedAssessments.filter(a => getAssessmentYear(a) === selectedYear);
  }

  const hasActiveFilters = selectedClass !== 'all' || selectedType !== 'all' || selectedSubtype !== 'all' || selectedPhase !== 'all' || selectedYear !== 'all';

  // Group assessments by class
  const groupedAssessments = displayedAssessments.reduce((groups, assessment) => {
    const grade = assessment.class_grade;
    if (!groups[grade]) {
      groups[grade] = [];
    }
    groups[grade].push(assessment);
    return groups;
  }, {} as Record<number, Assessment[]>);

  const classOptions = [4, 5, 6, 7, 8, 9, 10];

  return (
    <div className="app-container">
      {/* Sidebar - Desktop */}
      <aside className="app-sidebar">
        <div className="sidebar-header" style={{ paddingBottom: '16px', borderBottom: '1.5px solid var(--color-border)' }}>
          <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '36px', width: 'auto', display: 'block' }} />
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`} style={{ fontSize: '11px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{online ? 'wifi' : 'wifi_off'}</span>
              {online ? 'Online' : 'Offline'}
            </span>
          )}
        </div>

        {/* Sync Controls */}
        <div className="sidebar-section">
          <h3>Data Sync</h3>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Schools</span>
              {lastSchoolsSync ? (
                <span className="sync-time">
                  {formatTimeAgo(lastSchoolsSync)}
                </span>
              ) : (
                <span className="sync-time never">Never synced</span>
              )}
            </div>
            <button
              onClick={handleSyncSchools}
              disabled={!online || syncingSchools}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingSchools ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Assessments</span>
              <span className="sync-count">{assessments.length} loaded</span>
            </div>
            <button
              onClick={handleSyncAssessments}
              disabled={!online || syncingAssessments}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingAssessments ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>

          <div className="sync-item">
            <div className="sync-info">
              <span className="sync-label">Students</span>
              <span className="sync-count">{studentCount} loaded</span>
            </div>
            <button
              onClick={handleSyncStudents}
              disabled={!online || syncingStudents}
              className="sync-btn"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {syncingStudents ? (
                <span className="mini-spinner" />
              ) : (
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>sync</span>
              )}
            </button>
          </div>
        </div>

        {/* Sync Queue / Collapsible Pending Submissions */}
        <div className="sidebar-section">
          <button
            onClick={() => setSyncQueueExpanded(!syncQueueExpanded)}
            className="collapsible-sync-btn"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              backgroundColor: 'var(--color-bg)',
              border: '1.5px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '13px',
              color: 'var(--color-primary)',
              transition: 'all 0.2s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                className="material-symbols-rounded"
                style={{
                  fontSize: '18px',
                  color: pendingCount > 0 ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                  animation: syncStatus?.isSyncing ? 'spin 1s linear infinite' : 'none'
                }}
              >
                {syncStatus?.isSyncing ? 'sync' : pendingCount > 0 ? 'cloud_queue' : 'cloud_done'}
              </span>
              <span>Sync Queue</span>
              {pendingCount > 0 && (
                <span
                  style={{
                    backgroundColor: pendingSubmissions.some(s => s.status === 'failed') ? '#fee2e2' : '#fef3c7',
                    color: pendingSubmissions.some(s => s.status === 'failed') ? '#dc2626' : '#d97706',
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: 700
                  }}
                >
                  {pendingCount}
                </span>
              )}
            </div>
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: '18px',
                transform: syncQueueExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease'
              }}
            >
              expand_more
            </span>
          </button>

          {syncQueueExpanded && (
            <div className="sync-queue-collapsible-content" style={{ marginTop: '10px' }}>
              {pendingSubmissions.length === 0 ? (
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', textAlign: 'center', padding: '12px 0' }}>
                  All submissions synced! ✨
                </div>
              ) : (
                <>
                  <div className="pending-submissions-list" style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
                    {pendingSubmissions.map((sub) => (
                      <div key={sub.localId} className="pending-submission-item" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <div className="pending-sub-info" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="pending-sub-name" style={{ fontWeight: 600, fontSize: '13px' }}>
                              {sub.studentFirstName} {sub.studentLastName}
                            </span>
                            <span className={`pending-sub-status ${sub.status}`} style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              {sub.status === 'pending' && <><span className="material-symbols-rounded" style={{ fontSize: '12px' }}>schedule</span> Waiting</>}
                              {sub.status === 'syncing' && <><span className="material-symbols-rounded" style={{ fontSize: '12px', animation: 'spin 1s linear infinite' }}>sync</span> Syncing</>}
                              {sub.status === 'failed' && <><span className="material-symbols-rounded" style={{ fontSize: '12px', color: 'var(--color-error)' }}>error</span> Failed</>}
                            </span>
                          </div>
                          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                            {sub.assessmentTitle || `Assessment #${sub.formId}`} · Class {sub.classGrade}{sub.section}
                          </span>
                          {sub.errorMessage && (
                            <span style={{ fontSize: '10px', color: 'var(--color-error)', marginTop: '2px', wordBreak: 'break-word' }}>
                              {sub.errorMessage}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={async () => {
                      const { retryFailedSubmissions } = await import('@/lib/sync');
                      await retryFailedSubmissions();
                      await loadPendingSubmissions();
                    }}
                    disabled={!online || syncStatus?.isSyncing}
                    style={{
                      width: '100%',
                      marginTop: '10px',
                      padding: '8px 12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: 'var(--color-primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: online && !syncStatus?.isSyncing ? 'pointer' : 'not-allowed',
                      opacity: online && !syncStatus?.isSyncing ? 1 : 0.6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>sync</span>
                    {syncStatus?.isSyncing ? 'Syncing...' : 'Sync / Retry All'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>



        {/* Teacher Portal */}
        <div className="sidebar-section teacher-section">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>school</span>
            Teacher Portal
          </h3>
          {teacherSession ? (
            <>
              <div className="teacher-info">
                <span className="teacher-name">{teacherSession.fullName}</span>
                <span className="teacher-role">{teacherSession.role}</span>
              </div>
              <Link href="/grading" className="teacher-link" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>edit_note</span>
                Grading Dashboard
              </Link>
              <Link href="/students" className="teacher-link" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>group</span>
                Student Directory
              </Link>
              <button
                onClick={async () => {
                  await logoutTeacher();
                  setTeacherSession(null);
                }}
                className="logout-btn"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>logout</span>
                Logout
              </button>
            </>
          ) : (
            <Link href="/login" className="teacher-login-link" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>vpn_key</span>
              Teacher Login
            </Link>
          )}
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="mobile-header">
        <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '30px', width: 'auto', display: 'block' }} />
        <div className="mobile-header-right">
          {mounted && (
            <span className={`status-badge ${online ? 'online' : 'offline'}`} style={{ fontSize: '11px', padding: '2px 6px', display: 'inline-flex', alignItems: 'center' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{online ? 'wifi' : 'wifi_off'}</span>
            </span>
          )}
          {pendingCount > 0 && (
            <span className="mobile-pending-badge">{pendingCount}</span>
          )}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            style={{ display: 'inline-flex', alignItems: 'center' }}
          >
            <span className="material-symbols-rounded">menu</span>
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span>Menu</span>
              <button onClick={() => setMobileMenuOpen(false)} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>

            {pendingCount > 0 && (
              <div className="mobile-menu-section">
                <h4>Pending Submissions ({pendingCount})</h4>
                {pendingSubmissions.slice(0, 3).map((sub) => (
                  <div key={sub.localId} className="mobile-pending-item">
                    {sub.studentFirstName} {sub.studentLastName} - {sub.status}
                  </div>
                ))}
              </div>
            )}

            {cachedForms.length > 0 && (
              <div className="mobile-menu-section">
                <h4>Saved Offline ({cachedForms.length})</h4>
                {cachedForms.map(form => (
                  <Link
                    key={form.formId}
                    href={`/forms/${form.formId}`}
                    className="mobile-cached-item"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>save</span>
                    {form.formData.title}
                  </Link>
                ))}
              </div>
            )}

            {/* Teacher Portal - Mobile */}
            <div className="mobile-menu-section" style={{ borderTop: '1px solid #eee', paddingTop: '16px', marginTop: '16px' }}>
              <h4 style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>school</span>
                Teacher Portal
              </h4>
              {teacherSession ? (
                <>
                  <div style={{ marginBottom: '12px', fontSize: '14px', color: '#666' }}>
                     {teacherSession.fullName}
                  </div>
                  <Link
                    href="/grading"
                    className="mobile-cached-item"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{ background: '#f0f4ff', color: '#4c6ef5', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>edit_note</span>
                    Grading Dashboard
                  </Link>
                  <Link
                    href="/students"
                    className="mobile-cached-item"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{ background: '#f0f4ff', color: '#4c6ef5', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>group</span>
                    Student Directory
                  </Link>
                  <button
                    onClick={async () => {
                      await logoutTeacher();
                      setTeacherSession(null);
                      setMobileMenuOpen(false);
                    }}
                    className="logout-btn"
                    style={{ width: '100%', marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>logout</span>
                    Logout
                  </button>
                </>
              ) : (
                <Link
                  href="/login"
                  className="mobile-cached-item"
                  onClick={() => setMobileMenuOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>vpn_key</span>
                  Teacher Login
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="app-main">
        <header className="main-header" style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '20px',
          paddingBottom: '16px',
          borderBottom: '1px solid var(--color-border)'
        }}>
          <img src="/pijamLogo.svg" alt="PiJam Logo" style={{ height: '32px', width: 'auto' }} />
          <h1 style={{
            fontSize: '24px',
            fontWeight: 600,
            margin: 0,
            color: 'var(--color-text)',
            fontFamily: 'var(--font-sans)'
          }}>
            PiPulse Assessment Portal
          </h1>
        </header>

        {/* Top Filter Bar - Single Row */}
        <div className="top-filter-bar">
          {/* Class Filter */}
          <div className="filter-group">
            <label className="filter-group-label" htmlFor="filter-class">
              <span className="material-symbols-rounded filter-icon">school</span>
              Class
            </label>
            <select
              id="filter-class"
              className="filter-select"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">All Classes</option>
              {classOptions.map((grade) => (
                <option key={grade} value={grade}>Class {grade}</option>
              ))}
            </select>
          </div>

          <div className="filter-divider" />

          {/* Assessment Type Filter (Formative / Summative) */}
          <div className="filter-group">
            <label className="filter-group-label" htmlFor="filter-type">
              <span className="material-symbols-rounded filter-icon">category</span>
              Type
            </label>
            <select
              id="filter-type"
              className="filter-select"
              value={selectedType}
              onChange={(e) => {
                const val = e.target.value as 'all' | 'formative' | 'summative';
                setSelectedType(val);
                if (val !== 'formative') setSelectedSubtype('all');
                if (val !== 'summative') setSelectedPhase('all');
              }}
            >
              <option value="all">All Types</option>
              <option value="formative">Formative</option>
              <option value="summative">Summative</option>
            </select>
          </div>

          {/* Conditional Sub-filter: Formative (IP / EOM) or Summative (Phase) */}
          {selectedType === 'formative' && (
            <>
              <div className="filter-divider" />
              <div className="filter-group animate-fadeIn">
                <label className="filter-group-label" htmlFor="filter-subtype">
                  <span className="material-symbols-rounded filter-icon">tune</span>
                  Subtype
                </label>
                <select
                  id="filter-subtype"
                  className="filter-select filter-select-highlight"
                  value={selectedSubtype}
                  onChange={(e) => setSelectedSubtype(e.target.value)}
                >
                  <option value="all">All (IP & EOM)</option>
                  <option value="IP">IP (In-Progress)</option>
                  <option value="EOM">EOM (End of Module)</option>
                </select>
              </div>
            </>
          )}

          {selectedType === 'summative' && (
            <>
              <div className="filter-divider" />
              <div className="filter-group animate-fadeIn">
                <label className="filter-group-label" htmlFor="filter-phase">
                  <span className="material-symbols-rounded filter-icon">layers</span>
                  Phase
                </label>
                <select
                  id="filter-phase"
                  className="filter-select filter-select-highlight"
                  value={selectedPhase}
                  onChange={(e) => setSelectedPhase(e.target.value)}
                >
                  <option value="all">All Phases</option>
                  {availablePhases.map((phase) => (
                    <option key={phase} value={phase}>{phase}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="filter-divider" />

          {/* Academic Year Filter */}
          <div className="filter-group">
            <label className="filter-group-label" htmlFor="filter-year">
              <span className="material-symbols-rounded filter-icon">calendar_month</span>
              Year
            </label>
            <select
              id="filter-year"
              className="filter-select"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              <option value="all">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>

          <div className="filter-divider" />

          {/* Active Filter Counter & Reset */}
          <div className="filter-bar-end">
            <span className="filter-results-count">
              {displayedAssessments.length} {displayedAssessments.length === 1 ? 'assessment' : 'assessments'}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                className="filter-reset-btn"
                onClick={() => {
                  setSelectedClass('all');
                  setSelectedType('all');
                  setSelectedSubtype('all');
                  setSelectedPhase('all');
                  setSelectedYear('all');
                }}
                title="Reset all filters"
              >
                <span className="material-symbols-rounded" style={{ fontSize: '15px' }}>close</span>
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="loading-state">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <p>Loading assessments...</p>
          </div>
        )}

        {/* Lead / PM Notice Banner */}
        {mounted && isLeadOrPM && (
          <div className="lead-pm-notice-banner" style={{
            backgroundColor: '#fffbeb',
            border: '1.5px solid #fcd34d',
            borderRadius: 'var(--radius-md)',
            padding: '16px 20px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '28px', color: '#d97706' }}>info</span>
              <div>
                <strong style={{ color: '#92400e', fontSize: '15px', display: 'block' }}>
                  Notice: Logged in as {teacherSession?.fullName} ({teacherSession?.role})
                </strong>
                <span style={{ color: '#b45309', fontSize: '13px' }}>
                  Lead and Program Manager roles cannot open or submit assessments. Use the buttons below to access your dashboard flow.
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Link href="/grading" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                backgroundColor: 'var(--color-primary)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '13px',
                textDecoration: 'none'
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>edit_note</span>
                Grading Dashboard
              </Link>
              <Link href="/students" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                backgroundColor: 'white',
                border: '1.5px solid var(--color-primary)',
                color: 'var(--color-primary)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '13px',
                textDecoration: 'none'
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>group</span>
                Student Directory
              </Link>
            </div>
          </div>
        )}

        {/* Offline Mode Banner */}
        {mounted && !online && !loading && (
          <div className="offline-banner">
            <span className="offline-banner-icon">
              <span className="material-symbols-rounded" style={{ fontSize: '28px', color: '#b06000' }}>wifi_off</span>
            </span>
            <div className="offline-banner-content">
              <strong>You are offline</strong>
              <span>Only showing saved forms. {cachedForms.length} form(s) available.</span>
            </div>
          </div>
        )}

        {/* Syncing Banner */}
        {syncStatus?.isSyncing && (
          <div className="sync-banner">
            <span className="mini-spinner" />
            <span>Syncing data...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-banner">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'var(--color-error)' }}>warning</span>
              {error}
            </span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        {/* Assessments Grid */}
        {!loading && (
          <div className="assessments-grid">
            {selectedClass === 'all' ? (
              Object.entries(groupedAssessments)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([grade, items]) => (
                  <div key={grade} className="class-group">
                    <h2 className="class-header">Class {grade}</h2>
                    <div className="cards-row">
                      {groupAssessmentsByIdentifier(items).map((group) => (
                        <AssessmentGroupCard
                          key={group.id}
                          group={group}
                          cachedFormIds={cachedFormIds}
                          isOffline={!online}
                          isLeadOrPM={isLeadOrPM}
                        />
                      ))}
                    </div>
                  </div>
                ))
            ) : (
              <div className="cards-row">
                {groupAssessmentsByIdentifier(displayedAssessments).map((group) => (
                  <AssessmentGroupCard
                    key={group.id}
                    group={group}
                    cachedFormIds={cachedFormIds}
                    isOffline={!online}
                    isLeadOrPM={isLeadOrPM}
                  />
                ))}
              </div>
            )}

            {displayedAssessments.length === 0 && !loading && (
              <div className="empty-state">
                {!online ? (
                  <>
                    <p>No saved forms available offline.</p>
                    <p className="hint">Save forms while online to use them offline.</p>
                  </>
                ) : (
                  <>
                    <p>No assessments found matching the selected filters.</p>
                    {hasActiveFilters && (
                      <div style={{ marginTop: '12px' }}>
                        <button
                          type="button"
                          className="filter-reset-btn"
                          onClick={() => {
                            setSelectedClass('all');
                            setSelectedType('all');
                            setSelectedSubtype('all');
                            setSelectedPhase('all');
                            setSelectedYear('all');
                          }}
                        >
                          <span className="material-symbols-rounded" style={{ fontSize: '15px' }}>close</span>
                          Clear all filters
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Helper to group assessments by group_identifier
interface AssessmentGroup {
  id: string;
  title: string;
  description: string | null;
  class_grade: number;
  assessments: Assessment[];
}

function groupAssessmentsByIdentifier(assessments: Assessment[]): AssessmentGroup[] {
  const groups: Record<string, AssessmentGroup> = {};

  for (const a of assessments) {
    // If group_identifier exists, use it.
    // Otherwise, generate a composite key from class and title to group identical assessments
    // that might just differ by language.
    const key = a.group_identifier || `${a.class_grade}_${a.title.trim().toLowerCase()}`;

    if (!groups[key]) {
      groups[key] = {
        id: key,
        title: a.title,
        description: a.description,
        class_grade: a.class_grade,
        assessments: []
      };
    }

    groups[key].assessments.push(a);
  }

  return Object.values(groups);
}

function AssessmentGroupCard({
  group,
  cachedFormIds,
  isOffline,
  isLeadOrPM
}: {
  group: AssessmentGroup;
  cachedFormIds: Set<number>;
  isOffline: boolean;
  isLeadOrPM: boolean;
}) {
  const [showLanguages, setShowLanguages] = useState(false);

  // If user is Lead or PM, render card as restricted
  if (isLeadOrPM) {
    return (
      <div className="assessment-card disabled" style={{ opacity: 0.8, cursor: 'not-allowed' }}>
        <div className="card-header">
          <span className="card-class">Class {group.class_grade}</span>
          <span className="card-lang-badge" style={{ fontSize: '10px', background: '#fee2e2', color: '#dc2626', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
            Restricted for Lead/PM
          </span>
        </div>
        <h3 className="card-title">{group.title}</h3>
        {group.description && <p className="card-desc">{group.description}</p>}
        <div className="card-footer">
          <span className="card-action" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#9ca3af', fontSize: '12px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>block</span>
            Teacher Login Required to Submit
          </span>
        </div>
      </div>
    );
  }

  // Derive the list of all language variants for this assessment group.
  const variants: { assessment_id: number; language: string }[] = [];
  
  for (const a of group.assessments) {
    if (a.languages && a.languages.length > 0) {
      for (const lang of a.languages) {
        if (!variants.some(v => v.assessment_id === a.assessment_id && v.language === lang)) {
          variants.push({ assessment_id: a.assessment_id, language: lang });
        }
      }
    } else {
      const lang = a.language || 'English';
      if (!variants.some(v => v.assessment_id === a.assessment_id && v.language === lang)) {
        variants.push({ assessment_id: a.assessment_id, language: lang });
      }
    }
  }

  // Sorting: English first, then others alphabetically
  const sortedVariants = [...variants].sort((a, b) => {
    if (a.language === 'English') return -1;
    if (b.language === 'English') return 1;
    return a.language.localeCompare(b.language);
  });

  // If only 1 language variant exists in the entire group, show direct link
  if (sortedVariants.length === 1) {
    const variant = sortedVariants[0];
    const isCached = cachedFormIds.has(variant.assessment_id);
    const isDisabled = isOffline && !isCached;
    const lang = variant.language;

    return (
      <Link
        href={isDisabled ? '#' : `/forms/${variant.assessment_id}?lang=${lang}`}
        className={`assessment-card ${isDisabled ? 'disabled' : ''}`}
        aria-disabled={isDisabled}
      >
        <div className="card-header">
          <span className="card-class">Class {group.class_grade}</span>
          {isCached && <span className="card-cached" style={{ display: 'inline-flex', alignItems: 'center' }}><span className="material-symbols-rounded" style={{ fontSize: '16px', color: 'var(--color-success)' }}>save</span></span>}
          {lang && lang !== 'English' && (
            <span
              className="card-lang-badge"
              style={{
                fontSize: '10px',
                background: 'var(--color-secondary)',
                padding: '2px 6px',
                borderRadius: '4px',
                marginLeft: '6px',
                color: 'var(--color-text-secondary)',
                verticalAlign: 'middle'
              }}
            >
              {lang}
            </span>
          )}
        </div>
        <h3 className="card-title">{group.title}</h3>
        {group.description && <p className="card-desc">{group.description}</p>}
        <div className="card-footer">
          <span className="card-action" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {isDisabled ? (
              <>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>cloud_off</span>
                Not saved
              </>
            ) : (
              <>
                Start
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>arrow_forward</span>
              </>
            )}
          </span>
        </div>
      </Link>
    );
  }

  // Multiple languages -> Selection UI
  return (
    <div className={`assessment-card ${showLanguages ? 'expanded' : ''}`}>
      <div className="card-header">
        <span className="card-class">Class {group.class_grade}</span>
        <span
          className="card-lang-count"
          style={{
            fontSize: '11px',
            background: 'var(--color-secondary)',
            padding: '2px 8px',
            borderRadius: '10px',
            color: 'var(--color-text-secondary)'
          }}
        >
          {sortedVariants.length} Languages
        </span>
      </div>
      <h3 className="card-title">{group.title}</h3>
      {group.description && !showLanguages && (
        <p className="card-desc">{group.description}</p>
      )}

      {showLanguages ? (
        <div
          className="lang-selection"
          style={{
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px solid var(--color-border)',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <p
            className="lang-label"
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--color-text-secondary)',
              margin: '0 0 12px'
            }}
          >
            Select Language:
          </p>
          <div
            className="lang-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '8px',
              marginBottom: '16px'
            }}
          >
            {sortedVariants.map(v => {
              const isCached = cachedFormIds.has(v.assessment_id);
              const isDisabled = isOffline && !isCached;
              return (
                <Link
                  key={`${v.assessment_id}-${v.language}`}
                  href={isDisabled ? '#' : `/forms/${v.assessment_id}?lang=${v.language}`}
                  className={`lang-btn ${isDisabled ? 'disabled' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    background: isDisabled ? 'var(--color-bg)' : 'var(--color-secondary)',
                    border: '1px solid transparent',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    fontSize: '13px',
                    color: 'var(--color-text)',
                    opacity: isDisabled ? 0.5 : 1,
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <span>{v.language}</span>
                  {isCached && (
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', color: 'var(--color-success)' }}>
                      save
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
          <button
            className="cancel-lang-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowLanguages(false);
            }}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline'
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="card-footer">
          <button
            className="card-action-btn"
            onClick={() => setShowLanguages(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            Select Language
            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>arrow_forward</span>
          </button>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
