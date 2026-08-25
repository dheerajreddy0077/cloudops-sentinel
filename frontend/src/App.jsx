import { useEffect, useMemo, useState } from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import "./App.css";

const API_URL = "http://127.0.0.1:8000";
const INSTANCE_ID = "i-00016f068272f80f4";
const REFRESH_INTERVAL = 30000;

function App() {
  // ============================================================
  // STATE
  // ============================================================

  const [summary, setSummary] = useState(null);
  const [incidents, setIncidents] = useState([]);

  const [selectedIncident, setSelectedIncident] = useState(null);

  const [cpuData, setCpuData] = useState([]);
  const [ec2Health, setEc2Health] = useState(null);

  const [loading, setLoading] = useState(true);
  const [cpuLoading, setCpuLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState(null);

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // ============================================================
  // HELPER
  // ============================================================

  function clearMessages() {
    setError("");
    setSuccessMessage("");
  }

  // ============================================================
  // LOAD DASHBOARD SUMMARY + INCIDENTS
  // ============================================================

  async function loadDashboard() {
    try {
      setLoading(true);

      const [summaryResponse, incidentsResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/dashboard/summary`),
          fetch(`${API_URL}/api/incidents`),
        ]);

      if (!summaryResponse.ok) {
        throw new Error(
          `Dashboard summary returned ${summaryResponse.status}`
        );
      }

      if (!incidentsResponse.ok) {
        throw new Error(
          `Incidents API returned ${incidentsResponse.status}`
        );
      }

      const summaryData = await summaryResponse.json();
      const incidentsData = await incidentsResponse.json();

      setSummary(summaryData);

      const incidentList = Array.isArray(incidentsData)
        ? incidentsData
        : incidentsData.incidents || [];

      setIncidents(incidentList);
    } catch (err) {
      console.error("Dashboard error:", err);
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  // ============================================================
  // LOAD CPU DATA
  // ============================================================

  async function loadCpuData() {
    try {
      setCpuLoading(true);

      const response = await fetch(
        `${API_URL}/api/cloudwatch/ec2/${INSTANCE_ID}/cpu`
      );

      if (!response.ok) {
        throw new Error(
          `CPU API returned ${response.status}`
        );
      }

      const data = await response.json();

      const datapoints = Array.isArray(data.datapoints)
        ? data.datapoints
        : [];

      const sorted = [...datapoints]
        .filter(
          (point) =>
            point.Timestamp !== undefined &&
            point.Average !== undefined
        )
        .sort(
          (a, b) =>
            Date.parse(a.Timestamp) -
            Date.parse(b.Timestamp)
        );

      setCpuData(sorted);
    } catch (err) {
      console.error("CPU error:", err);
    } finally {
      setCpuLoading(false);
    }
  }

  // ============================================================
  // LOAD EC2 HEALTH
  // ============================================================

  async function loadEc2Health() {
    try {
      const response = await fetch(
        `${API_URL}/api/ec2/${INSTANCE_ID}/status`
      );

      if (!response.ok) {
        throw new Error(
          `EC2 status returned ${response.status}`
        );
      }

      const data = await response.json();

      setEc2Health(data);
    } catch (err) {
      console.error("EC2 health error:", err);
    }
  }

  // ============================================================
  // LOAD EVERYTHING
  // ============================================================

  async function loadAll() {
    clearMessages();

    await Promise.all([
      loadDashboard(),
      loadCpuData(),
      loadEc2Health(),
    ]);
  }

  // ============================================================
  // LOAD INCIDENT DETAILS
  // ============================================================

  async function loadIncidentDetails(incidentId) {
    try {
      setDetailsLoading(true);
      setSelectedIncident(null);
      setError("");

      const response = await fetch(
        `${API_URL}/api/incidents/${incidentId}`
      );

      if (!response.ok) {
        throw new Error(
          `Incident API returned ${response.status}`
        );
      }

      const data = await response.json();

      setSelectedIncident(
        data.incident || data
      );
    } catch (err) {
      console.error(
        "Incident details error:",
        err
      );

      setError(
        err.message ||
          "Failed to load incident details"
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  // ============================================================
  // RESOLVE INCIDENT
  // ============================================================

  async function resolveIncident(incidentId) {
    try {
      setActionLoading(
        `resolve-${incidentId}`
      );

      clearMessages();

      const response = await fetch(
        `${API_URL}/api/incidents/${incidentId}/resolve`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            `Resolve failed with status ${response.status}`
        );
      }

      setSuccessMessage(
        "Incident resolved successfully."
      );

      // Close modal
      setSelectedIncident(null);

      // Reload dashboard data
      await loadDashboard();
    } catch (err) {
      console.error(
        "Resolve incident error:",
        err
      );

      setError(
        err.message ||
          "Failed to resolve incident"
      );
    } finally {
      setActionLoading(null);
    }
  }

  // ============================================================
  // REMEDIATE INCIDENT
  // ============================================================

  async function remediateIncident(incidentId) {
    try {
      setActionLoading(
        `remediate-${incidentId}`
      );

      clearMessages();

      const response = await fetch(
        `${API_URL}/api/incidents/${incidentId}/remediate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            data.error ||
            `Remediation failed with status ${response.status}`
        );
      }

      setSuccessMessage(
        data.message ||
          "Remediation completed successfully."
      );

      // Reload dashboard
      await loadDashboard();

      // Refresh EC2 health
      await loadEc2Health();

      // Refresh CPU
      await loadCpuData();

      // Reload incident details
      await loadIncidentDetails(
        incidentId
      );
    } catch (err) {
      console.error(
        "Remediation error:",
        err
      );

      setError(
        err.message ||
          "Failed to remediate incident"
      );
    } finally {
      setActionLoading(null);
    }
  }

  // ============================================================
  // INITIAL LOAD + AUTO REFRESH
  // ============================================================

  useEffect(() => {
    loadAll();

    const interval = setInterval(() => {
      loadDashboard();
      loadCpuData();
      loadEc2Health();
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  // ============================================================
  // CPU GRAPH DATA
  // ============================================================

  const chartData = useMemo(() => {
    return cpuData.map((point) => ({
      time: new Date(
        point.Timestamp
      ).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),

      cpu: Number(
        point.Average || 0
      ),
    }));
  }, [cpuData]);

  // ============================================================
  // CPU STATISTICS
  // ============================================================

  const currentCpu =
    cpuData.length > 0
      ? Number(
          cpuData[
            cpuData.length - 1
          ].Average || 0
        )
      : 0;

  const averageCpu =
    cpuData.length > 0
      ? cpuData.reduce(
          (sum, point) =>
            sum +
            Number(
              point.Average || 0
            ),
          0
        ) / cpuData.length
      : 0;

  const maximumCpu =
    cpuData.length > 0
      ? Math.max(
          ...cpuData.map((point) =>
            Number(
              point.Average || 0
            )
          )
        )
      : 0;

  const cpuPercent = Math.min(
    Math.max(currentCpu, 0),
    100
  );

  // ============================================================
  // CPU STATUS
  // ============================================================

  let cpuStatus = "NORMAL";
  let cpuStatusClass =
    "badge-healthy";

  if (currentCpu >= 85) {
    cpuStatus = "HIGH CPU";
    cpuStatusClass =
      "badge-high";
  } else if (currentCpu >= 70) {
    cpuStatus = "WARNING";
    cpuStatusClass =
      "badge-attention";
  }

  // ============================================================
  // EC2 HEALTH
  // ============================================================

  const healthHealthy =
    ec2Health?.state === "running" &&
    ec2Health?.system_status === "ok" &&
    ec2Health?.instance_status === "ok";

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="app-shell">

      {/* ======================================================
          HEADER
          ====================================================== */}

      <header className="topbar">

        <div className="brand">

          <div className="brand-icon">
            CS
          </div>

          <div>
            <h1>
              CloudOps Sentinel
            </h1>

            <p>
              Cloud infrastructure
              monitoring & incident
              response
            </p>
          </div>

        </div>

        <button
          className="refresh-button"
          onClick={loadAll}
          disabled={loading}
        >
          {loading
            ? "Refreshing..."
            : "Refresh"}
        </button>

      </header>

      {/* ======================================================
          MAIN
          ====================================================== */}

      <main className="dashboard-container">

        {/* ====================================================
            HERO
            ==================================================== */}

        <section className="hero-section">

          <div>

            <p className="eyebrow">
              Infrastructure Operations
            </p>

            <h2>
              Operations Dashboard
            </h2>

            <p className="hero-description">
              Monitor AWS infrastructure
              health, CPU utilization and
              incidents from one place.
            </p>

          </div>

          <div
            className={`system-status ${
              healthHealthy
                ? "healthy"
                : "warning"
            }`}
          >

            <span className="status-dot"></span>

            <div>

              <strong>
                {healthHealthy
                  ? "EC2 System Healthy"
                  : "EC2 Requires Attention"}
              </strong>

              <small>
                {INSTANCE_ID}
              </small>

            </div>

          </div>

        </section>

        {/* ====================================================
            ERROR
            ==================================================== */}

        {error && (
          <div className="alert error-alert">

            <span>●</span>

            {error}

          </div>
        )}

        {/* ====================================================
            SUCCESS
            ==================================================== */}

        {successMessage && (
          <div className="alert success-alert">

            <span>●</span>

            {successMessage}

          </div>
        )}

        {/* ====================================================
            SUMMARY CARDS
            ==================================================== */}

        {summary && (
          <section className="metrics-grid">

            <div className="metric-card">

              <span className="metric-label">
                Total Incidents
              </span>

              <div className="metric-value">
                {summary.total_incidents ??
                  0}
              </div>

              <div className="metric-description">
                All recorded incidents
              </div>

            </div>

            <div className="metric-card accent-warning">

              <span className="metric-label">
                Open Incidents
              </span>

              <div className="metric-value">
                {summary.open_incidents ??
                  0}
              </div>

              <div className="metric-description">
                Require attention
              </div>

            </div>

            <div className="metric-card accent-success">

              <span className="metric-label">
                Resolved
              </span>

              <div className="metric-value">
                {summary.resolved_incidents ??
                  0}
              </div>

              <div className="metric-description">
                Successfully resolved
              </div>

            </div>

            <div className="metric-card accent-danger">

              <span className="metric-label">
                High Severity
              </span>

              <div className="metric-value">
                {summary.high_severity_incidents ??
                  0}
              </div>

              <div className="metric-description">
                High priority incidents
              </div>

            </div>

            <div className="metric-card accent-success">

              <span className="metric-label">
                Remediated
              </span>

              <div className="metric-value">
                {summary.remediated_incidents ??
                  0}
              </div>

              <div className="metric-description">
                Automated remediation
              </div>

            </div>

          </section>
        )}

        {/* ====================================================
            CLOUDWATCH CPU
            ==================================================== */}

        <section className="cpu-panel">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                Amazon CloudWatch
              </p>

              <h2>
                CPU Utilization
              </h2>

            </div>

            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
              }}
            >

              <span
                className={`badge ${cpuStatusClass}`}
              >
                ● {cpuStatus}
              </span>

              <span className="badge badge-live">
                ● LIVE
              </span>

            </div>

          </div>

          {/* CPU OVERVIEW */}

          <div className="cpu-overview">

            <div className="cpu-main">

              <span className="cpu-label">
                Current CPU
              </span>

              <div className="cpu-value">
                {currentCpu.toFixed(2)}%
              </div>

              <span className="cpu-instance">
                {INSTANCE_ID}
              </span>

            </div>

            <div className="cpu-stat">

              <span>
                Average
              </span>

              <strong>
                {averageCpu.toFixed(2)}%
              </strong>

            </div>

            <div className="cpu-stat">

              <span>
                Maximum
              </span>

              <strong>
                {maximumCpu.toFixed(2)}%
              </strong>

            </div>

          </div>

          {/* CPU METER */}

          <div className="cpu-meter">

            <div className="cpu-meter-header">

              <span>
                CPU Load
              </span>

              <span>
                {currentCpu.toFixed(2)}%
              </span>

            </div>

            <div className="cpu-track">

              <div
                className="cpu-fill"
                style={{
                  width: `${cpuPercent}%`,
                }}
              />

            </div>

            <div className="cpu-scale">

              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>

            </div>

          </div>

          {/* CPU HISTORY */}

          <div className="cpu-history">

            <h3>
              CPU History
            </h3>

            {cpuLoading ? (

              <div className="empty-state">
                Loading CloudWatch
                metrics...
              </div>

            ) : chartData.length === 0 ? (

              <div className="empty-state">
                No CPU data available.
              </div>

            ) : (

              <div
                style={{
                  width: "100%",
                  height: 280,
                }}
              >

                <ResponsiveContainer
                  width="100%"
                  height="100%"
                >

                  <LineChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 15,
                      left: 0,
                      bottom: 5,
                    }}
                  >

                    <CartesianGrid
                      stroke="#202b38"
                      strokeDasharray="3 3"
                    />

                    <XAxis
                      dataKey="time"
                      tick={{
                        fill: "#718092",
                        fontSize: 11,
                      }}
                      axisLine={{
                        stroke:
                          "#25303d",
                      }}
                      tickLine={false}
                    />

                    <YAxis
                      domain={[
                        0,
                        "auto",
                      ]}
                      tick={{
                        fill: "#718092",
                        fontSize: 11,
                      }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(value) =>
                        `${Number(
                          value
                        ).toFixed(1)}%`
                      }
                    />

                    <Tooltip
                      contentStyle={{
                        background:
                          "#0d141c",
                        border:
                          "1px solid #2a3543",
                        borderRadius:
                          "8px",
                        color:
                          "#e5edf5",
                        fontSize:
                          "12px",
                      }}
                      labelStyle={{
                        color:
                          "#8b98a8",
                        marginBottom:
                          "5px",
                      }}
                      formatter={(value) => [
                        `${Number(
                          value
                        ).toFixed(2)}%`,
                        "CPU",
                      ]}
                    />

                    <Line
                      type="monotone"
                      dataKey="cpu"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{
                        r: 3,
                        fill:
                          "#60a5fa",
                        strokeWidth: 0,
                      }}
                      activeDot={{
                        r: 5,
                      }}
                    />

                  </LineChart>

                </ResponsiveContainer>

              </div>

            )}

            {/* RECENT READINGS */}

            {chartData.length > 0 && (

              <div className="cpu-readings">

                <h3>
                  Recent CPU Readings
                </h3>

                {[...cpuData]
                  .slice(-5)
                  .reverse()
                  .map(
                    (
                      point,
                      index
                    ) => {

                      const value =
                        Number(
                          point.Average ||
                            0
                        );

                      return (

                        <div
                          className="cpu-reading"
                          key={`${point.Timestamp}-${index}`}
                        >

                          <span className="reading-time">

                            {new Date(
                              point.Timestamp
                            ).toLocaleTimeString(
                              [],
                              {
                                hour: "2-digit",
                                minute:
                                  "2-digit",
                              }
                            )}

                          </span>

                          <div className="reading-bar">

                            <div
                              className="reading-fill"
                              style={{
                                width: `${Math.min(
                                  Math.max(
                                    value,
                                    0
                                  ),
                                  100
                                )}%`,
                              }}
                            />

                          </div>

                          <strong>
                            {value.toFixed(2)}%
                          </strong>

                        </div>

                      );
                    }
                  )}

              </div>

            )}

          </div>

        </section>

        {/* ====================================================
            EC2 HEALTH
            ==================================================== */}

        <section className="health-panel">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                Amazon EC2
              </p>

              <h2>
                Instance Health
              </h2>

            </div>

            {ec2Health && (

              <span
                className={`badge ${
                  healthHealthy
                    ? "badge-healthy"
                    : "badge-attention"
                }`}
              >
                {healthHealthy
                  ? "HEALTHY"
                  : "ATTENTION"}
              </span>

            )}

          </div>

          <div className="health-grid">

            <div className="health-main">

              <div className="instance-icon">
                EC2
              </div>

              <div>

                <span className="health-label">
                  Instance ID
                </span>

                <code>
                  {INSTANCE_ID}
                </code>

              </div>

            </div>

            <div className="health-item">

              <span>
                Instance State
              </span>

              <strong>
                {ec2Health?.state ||
                  "checking"}
              </strong>

            </div>

            <div className="health-item">

              <span>
                System Status
              </span>

              <strong>
                {ec2Health?.system_status ||
                  "checking"}
              </strong>

            </div>

            <div className="health-item">

              <span>
                Instance Status
              </span>

              <strong>
                {ec2Health?.instance_status ||
                  "checking"}
              </strong>

            </div>

            <div className="health-item">

              <span>
                Region
              </span>

              <strong>
                ap-south-1
              </strong>

            </div>

          </div>

        </section>

        {/* ====================================================
            INCIDENTS
            ==================================================== */}

        <section className="incidents-panel">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                Incident Management
              </p>

              <h2>
                Recent Incidents
              </h2>

            </div>

            <span className="incident-count">
              {incidents.length} incidents
            </span>

          </div>

          <div className="table-container">

            <table className="incident-table">

              <thead>

                <tr>

                  <th>
                    Incident
                  </th>

                  <th>
                    Resource
                  </th>

                  <th>
                    Type
                  </th>

                  <th>
                    Severity
                  </th>

                  <th>
                    Status
                  </th>

                  <th>
                    Region
                  </th>

                  <th>
                    Action
                  </th>

                </tr>

              </thead>

              <tbody>

                {incidents.length === 0 ? (

                  <tr>

                    <td
                      colSpan="7"
                      className="empty-state"
                    >
                      No incidents found.
                    </td>

                  </tr>

                ) : (

                  incidents.map(
                    (incident) => {

                      const isOpen =
                        String(
                          incident.status ||
                            ""
                        ).toUpperCase() ===
                        "OPEN";

                      const isRemediated =
                        String(
                          incident.remediation_status ||
                            ""
                        ).toUpperCase() ===
                        "SUCCESS";

                      return (

                        <tr
                          key={
                            incident.incident_id
                          }
                        >

                          {/* INCIDENT */}

                          <td>

                            <button
                              className="incident-id"
                              onClick={() =>
                                loadIncidentDetails(
                                  incident.incident_id
                                )
                              }
                            >
                              {incident.incident_id?.slice(
                                0,
                                8
                              )}
                              ...
                            </button>

                          </td>

                          {/* RESOURCE */}

                          <td>
                            {incident.resource ||
                              "-"}
                          </td>

                          {/* TYPE */}

                          <td>
                            {incident.type ||
                              "-"}
                          </td>

                          {/* SEVERITY */}

                          <td>

                            <span
                              className={`badge ${
                                incident.severity
                                  ? `badge-${String(
                                      incident.severity
                                    ).toLowerCase()}`
                                  : ""
                              }`}
                            >
                              {incident.severity ||
                                "-"}
                            </span>

                          </td>

                          {/* STATUS */}

                          <td>

                            <span
                              className={`badge ${
                                incident.status
                                  ? `badge-${String(
                                      incident.status
                                    ).toLowerCase()}`
                                  : ""
                              }`}
                            >
                              {incident.status ||
                                "-"}
                            </span>

                          </td>

                          {/* REGION */}

                          <td>
                            {incident.region ||
                              "-"}
                          </td>

                          {/* ACTIONS */}

                          <td>

                            <div
                              style={{
                                display:
                                  "flex",
                                gap: "6px",
                                flexWrap:
                                  "wrap",
                              }}
                            >

                              <button
                                className="view-button"
                                onClick={() =>
                                  loadIncidentDetails(
                                    incident.incident_id
                                  )
                                }
                              >
                                View
                              </button>

                              {isOpen && (
                                <>

                                  <button
                                    className="view-button"
                                    disabled={
                                      actionLoading ===
                                      `remediate-${incident.incident_id}`
                                    }
                                    onClick={() =>
                                      remediateIncident(
                                        incident.incident_id
                                      )
                                    }
                                  >

                                    {actionLoading ===
                                    `remediate-${incident.incident_id}`
                                      ? "Working..."
                                      : isRemediated
                                      ? "Remediated"
                                      : "Remediate"}

                                  </button>

                                  <button
                                    className="view-button"
                                    disabled={
                                      actionLoading ===
                                      `resolve-${incident.incident_id}`
                                    }
                                    onClick={() =>
                                      resolveIncident(
                                        incident.incident_id
                                      )
                                    }
                                  >

                                    {actionLoading ===
                                    `resolve-${incident.incident_id}`
                                      ? "Resolving..."
                                      : "Resolve"}

                                  </button>

                                </>
                              )}

                            </div>

                          </td>

                        </tr>

                      );
                    }
                  )

                )}

              </tbody>

            </table>

          </div>

        </section>

      </main>

      {/* ======================================================
          INCIDENT DETAILS MODAL
          ====================================================== */}

      {(selectedIncident ||
        detailsLoading) && (

        <div
          className="modal-overlay"
          onClick={() => {
            if (!detailsLoading) {
              setSelectedIncident(null);
            }
          }}
        >

          <div
            className="incident-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            {/* MODAL HEADER */}

            <div className="modal-header">

              <div>

                <h2>
                  Incident Details
                </h2>

                {selectedIncident && (
                  <code>
                    {
                      selectedIncident.incident_id
                    }
                  </code>
                )}

              </div>

              <button
                className="close-button"
                onClick={() =>
                  setSelectedIncident(null)
                }
              >
                ×
              </button>

            </div>

            {/* LOADING */}

            {detailsLoading ? (

              <div className="empty-state">
                Loading incident
                details...
              </div>

            ) : (

              selectedIncident && (

                <>

                  {/* DETAIL GRID */}

                  <div className="details-grid">

                    <div className="detail-item">

                      <span>
                        Resource
                      </span>

                      <strong>
                        {selectedIncident.resource ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Type
                      </span>

                      <strong>
                        {selectedIncident.type ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Severity
                      </span>

                      <strong>
                        {selectedIncident.severity ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Status
                      </span>

                      <strong>
                        {selectedIncident.status ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Region
                      </span>

                      <strong>
                        {selectedIncident.region ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Alarm
                      </span>

                      <strong>
                        {selectedIncident.alarm_name ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Remediation
                      </span>

                      <strong>
                        {selectedIncident.remediation_status ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Verification
                      </span>

                      <strong>
                        {selectedIncident.remediation_verification ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Instance State
                      </span>

                      <strong>
                        {selectedIncident.remediation_instance_state ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        System Status
                      </span>

                      <strong>
                        {selectedIncident.remediation_system_status ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Instance Status
                      </span>

                      <strong>
                        {selectedIncident.remediation_instance_status ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Remediation Updated
                      </span>

                      <strong>
                        {selectedIncident.remediation_updated_at ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item full-width">

                      <span>
                        Description
                      </span>

                      <strong>
                        {selectedIncident.description ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item full-width">

                      <span>
                        Resolution Reason
                      </span>

                      <strong>
                        {selectedIncident.resolution_reason ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Created At
                      </span>

                      <strong>
                        {selectedIncident.created_at ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item">

                      <span>
                        Updated At
                      </span>

                      <strong>
                        {selectedIncident.updated_at ||
                          "-"}
                      </strong>

                    </div>

                    <div className="detail-item full-width">

                      <span>
                        Remediation Message
                      </span>

                      <strong>
                        {selectedIncident.remediation_message ||
                          "-"}
                      </strong>

                    </div>

                  </div>

                  {/* ==================================================
                      MODAL ACTIONS
                      ================================================== */}

                  <div
                    style={{
                      display: "flex",
                      justifyContent:
                        "flex-end",
                      gap: "10px",
                      marginTop:
                        "24px",
                      flexWrap:
                        "wrap",
                    }}
                  >

                    {String(
                      selectedIncident.status ||
                        ""
                    ).toUpperCase() ===
                      "OPEN" && (
                      <>

                        <button
                          className="view-button"
                          disabled={
                            actionLoading ===
                            `remediate-${selectedIncident.incident_id}`
                          }
                          onClick={() =>
                            remediateIncident(
                              selectedIncident.incident_id
                            )
                          }
                        >

                          {actionLoading ===
                          `remediate-${selectedIncident.incident_id}`
                            ? "Remediating..."
                            : "Remediate"}

                        </button>

                        <button
                          className="view-button"
                          disabled={
                            actionLoading ===
                            `resolve-${selectedIncident.incident_id}`
                          }
                          onClick={() =>
                            resolveIncident(
                              selectedIncident.incident_id
                            )
                          }
                        >

                          {actionLoading ===
                          `resolve-${selectedIncident.incident_id}`
                            ? "Resolving..."
                            : "Resolve"}

                        </button>

                      </>
                    )}

                  </div>

                </>

              )

            )}

          </div>

        </div>

      )}

    </div>
  );
}

export default App;
