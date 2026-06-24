-- Додаємо роль superadmin (глобальний власник сервісу).
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'superadmin' BEFORE 'owner';
