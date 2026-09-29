-- 首发版联名合作、审核与合同均在线下完成；应用不再保存线上合同台账。
DELETE FROM "platform_configs" WHERE "config_key" = 'collab_breach_policy';
DROP TABLE "creator_contracts";
