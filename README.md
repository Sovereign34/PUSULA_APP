# pusula-core

Bowlera Beyin / PUSULA OS'un paylaşılan governance çekirdeği. IG-ADS-MODULE,
TIKTOK-ADS-MODULE ve ileride Adisyo/WhatsApp entegrasyonları bu çekirdeğe
bağlanacak — her modül kendi Executor/Critic/Policy Engine'ini taşır, ama
audit trail ailesi tek ve ortaktır (aynı hash-chain, aynı şema).

## Durum (2026-08-22)

- **Faz 0 (işletme açılışı):** Tamamlanmadı — Adisyo/pazaryeri üyeliği yok.
- **Faz 1 (Adisyo entegrasyonu):** Faz 0'a bağımlı, başlamadı.
- **Faz 2 (Hetzner + n8n):** VPS henüz satın alınmadı/kurulmadı. Bu repo,
  o an geldiğinde `docker compose up` ile ayağa kalkacak şekilde hazırlandı.
- **Bu repo:** Canlı kimlik bilgisi veya VPS gerektirmeyen çekirdek —
  audit log şeması + hash-chain yazıcı modülü + n8n/Postgres iskeleti.

## Yapı

```
audit-log/
  auditLog.js       — AUDIT_SCHEMA.md §1 satırını üretir, append-only yazar
  auditLog.test.js  — 25/25 test (assert + custom runner, IG-ADS deseniyle aynı)
db/migrations/
  001_audit_log.sql — audit_log tablosu DDL (AUDIT_SCHEMA.md §1 birebir)
docker/
  docker-compose.yml — n8n + Postgres, Hetzner CX22 için
  .env.example        — CONFIG_SCHEMA.md §1 şeması, gerçek secret yok
```

## Neden ayrı bir audit modülü var, IG-ADS'inki kullanılmadı?

IG-ADS-MODULE/audit-log/auditLog.js kampanya-özel alanlar taşır
(campaign_brief, meta_api_response). Bu modül AUDIT_SCHEMA.md §1'deki
Pusula-geneli alanları (quarantine_analysis, executor_output, critic_verdict,
policy_decision, final_outcome) kullanır — hash-chain mantığı (previous_hash/
record_hash/chain_broken, AMC-6 fail-closed davranışı) birebir aynı, bilerek
tekrar edildi (tek kaynak yerine iki modülün kendi domain'ine sadık kalması
tercih edildi — AGENT.md §27 "duplicate functionality" yasağı burada
uygulanmaz çünkü alan setleri gerçekten farklı, mantık aynı).

## Test çalıştırma

```bash
node audit-log/auditLog.test.js
```

## Sıradaki adım

Bu iskelet tek başına bir şey yapmaz — n8n workflow'larının bu modülü
her karar dalının sonunda çağırması gerekir (AUDIT_SCHEMA.md §3, "her dalda
log"). Faz 2 (Hetzner kurulumu) tamamlanınca gerçek n8n workflow'ları bu
repo ile birlikte yazılacak.
