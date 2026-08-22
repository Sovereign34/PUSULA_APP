-- 001_audit_log.sql
-- Kaynak: PUSULA_OS/AUDIT_SCHEMA.md §1 — birebir alındı.
-- Not: final_outcome / policy_decision / append-only ilkesi CORE.md §4
-- ("Policy Engine AI değil") ve AUDIT_SCHEMA.md §3 ("her dalda log")
-- kurallarının veritabanı karşılığıdır — bu dosyaya dokunmadan önce o
-- iki bölüm okunmalı.

CREATE TABLE IF NOT EXISTS audit_log (
    log_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id         UUID NOT NULL,              -- ARCHITECTURE §1.2 decision_id ile eşleşir
    decision_type       TEXT NOT NULL,               -- review_reply | content_draft | campaign_suggestion | budget_change
    trigger_source      TEXT NOT NULL,               -- yemeksepeti_comment | google_review | whatsapp_message | instagram_dm | ...

    -- Karantina katmanı (ARCHITECTURE §1.1) — ham metin SADECE burada saklanır
    raw_input_payload    JSONB,
    quarantine_analysis  JSONB NOT NULL,
    crisis_flag          BOOLEAN NOT NULL DEFAULT FALSE,

    -- Executor katmanı (ARCHITECTURE §1.2)
    executor_output      JSONB,                       -- crisis_flag=true ise NULL kalabilir

    -- Critic katmanı (ARCHITECTURE §1.3) — requires_critic=false ise NULL
    critic_verdict        JSONB,

    -- Policy Engine katmanı (ARCHITECTURE §1.4)
    policy_decision        JSONB NOT NULL,              -- ALLOW/BLOCK/ESCALATE her zaman dolu

    final_outcome           TEXT NOT NULL,                -- AUTO_APPLIED | HUMAN_QUEUE | BLOCKED
    human_queue_ref          UUID,                         -- HUMAN_ESCALATION_PROTOCOL.md kuyruk kaydına referans, varsa

    -- Hash-chain bütünlüğü (IG-ADS-MODULE/audit-log/auditLog.js deseniyle
    -- birebir tutarlı — Pusula genelinde tek bir zincir mantığı kullanılır)
    record_hash              TEXT NOT NULL,
    previous_hash             TEXT NOT NULL,               -- ilk kayıt için 'GENESIS'
    chain_broken               BOOLEAN NOT NULL DEFAULT FALSE,

    created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_decision_type ON audit_log (decision_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at    ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_final_outcome ON audit_log (final_outcome);

-- TASLAK — Faz 2'de gerçek DB rolleriyle uygulanacak (AUDIT_SCHEMA.md §1 notu):
-- REVOKE UPDATE, DELETE ON audit_log FROM pusula_app_role;
