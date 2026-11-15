# Arşivlenmiş Eski MySQL Şema Dosyaları

Bu klasördeki SQL dosyaları (`mysql_schema.sql`, `mysql_001_full_ecosystem.sql`), projenin erken dönem MySQL 8.0 / Hostinger tasarımından kalma eski şemalardır.

- Uygulamanın **aktif** veritabanı katmanı `better-sqlite3` kullanmaktadır ve `server/db/schema.ts` üzerinden yönetilir.
- Bu dosyalar hiçbir kod tarafından import edilmez veya çalıştırılmaz; yalnızca geçmiş referans amacıyla arşivlenmiştir.
