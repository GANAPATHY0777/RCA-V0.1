-- Evidence-Based AI Root Cause Analysis — Database Schema

-- Orders table (order-service)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    item VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table (payment-service)
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'processed',
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Telemetry spans (collected from OTel)
CREATE TABLE IF NOT EXISTS telemetry_spans (
    id SERIAL PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL,
    span_id VARCHAR(32) NOT NULL,
    parent_span_id VARCHAR(32),
    service_name VARCHAR(255) NOT NULL,
    operation_name VARCHAR(255) NOT NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    duration_ms DOUBLE PRECISION NOT NULL,
    status_code INTEGER DEFAULT 0,
    attributes JSONB DEFAULT '{}',
    ingested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spans_service ON telemetry_spans(service_name);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON telemetry_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_time ON telemetry_spans(ingested_at);

-- Telemetry metrics (collected from OTel)
CREATE TABLE IF NOT EXISTS telemetry_metrics (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    unit VARCHAR(50),
    attributes JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_service ON telemetry_metrics(service_name);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON telemetry_metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_time ON telemetry_metrics(timestamp);

-- Anomaly events (from anomaly-detector)
CREATE TABLE IF NOT EXISTS anomaly_events (
    id SERIAL PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    metric_name VARCHAR(255) NOT NULL,
    metric_value DOUBLE PRECISION NOT NULL,
    baseline_mean DOUBLE PRECISION NOT NULL,
    baseline_std DOUBLE PRECISION NOT NULL,
    z_score DOUBLE PRECISION NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_service ON anomaly_events(service_name);
CREATE INDEX IF NOT EXISTS idx_anomalies_time ON anomaly_events(detected_at);

-- Incidents (from correlation engine)
CREATE TABLE IF NOT EXISTS incidents (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL DEFAULT 'detected',
    -- detected, analyzing, awaiting_approval, approved, recovering, healthy, recovery_failed, rejected
    root_cause_service VARCHAR(255),
    root_cause_metric VARCHAR(255),
    confidence_pct DOUBLE PRECISION,
    confidence_formula TEXT,
    scoring_details JSONB DEFAULT '{}',
    naive_baseline JSONB DEFAULT '{}',
    ai_reasoning JSONB DEFAULT '{}',
    recommended_action TEXT,
    recovery_target_container VARCHAR(255),
    anomaly_ids INTEGER[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);

-- Approval log (audit trail)
CREATE TABLE IF NOT EXISTS approval_log (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER REFERENCES incidents(id),
    action VARCHAR(20) NOT NULL, -- 'approve' or 'reject'
    acting_user VARCHAR(255) NOT NULL,
    reason TEXT,
    acted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_incident ON approval_log(incident_id);

-- Diagnosis log (Operator Mode guesses and scoring)
CREATE TABLE IF NOT EXISTS diagnosis_log (
    id SERIAL PRIMARY KEY,
    incident_id INTEGER REFERENCES incidents(id),
    operator VARCHAR(255) NOT NULL,
    guessed_service VARCHAR(255),
    actual_service VARCHAR(255),
    is_correct BOOLEAN,
    timed_out BOOLEAN DEFAULT FALSE,
    time_taken_seconds DOUBLE PRECISION,
    diagnosed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_incident ON diagnosis_log(incident_id);
