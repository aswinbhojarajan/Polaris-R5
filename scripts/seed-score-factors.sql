-- ==================================================
-- SCORE FACTORS - Production Seed Data
-- ==================================================
-- ⚠️  WARNING: This table contains RUN-SPECIFIC data
-- ==================================================
-- This data is linked to specific prompt_run_item_id values.
-- You should NOT seed this in production unless you're migrating
-- actual run results along with their parent records.
--
-- This is NOT configuration data - it's results data from
-- actual prompt runs in your development environment.
-- ==================================================

-- Only uncomment and use if you're migrating actual run data:

/*
INSERT INTO score_factors (id, prompt_run_item_id, category, score, relevance_value, position_value, positive_mentions, neutral_mentions, negative_mentions, mentions_count, heading_hits_count, created_at) VALUES
('02661035-3b40-4204-bed3-08c130f0aab1', '43a2b367-c13d-4ac5-8844-0520caa13814', 'Position', 0.00, 0.00, NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-08 23:34:00.793172'),
('07f0c2c4-1401-44f6-82f0-955f6a1621c2', '5483141a-3ece-41c3-90d8-6736b70f024a', 'Sentiment', 89.00, NULL, NULL, 3, 0, 0, NULL, NULL, '2025-10-08 23:25:58.19003'),
('1bce39d0-2418-4058-bb46-92d63aeefad4', '8ca42294-7675-4821-a5b9-2ce3fa4d0847', 'Visibility', 42.89, NULL, NULL, NULL, NULL, NULL, 1, 0, '2025-10-08 23:31:28.253948'),
('355197c3-ed33-4e18-9393-dd9fafe2c6ea', '8ca42294-7675-4821-a5b9-2ce3fa4d0847', 'Sentiment', 77.75, NULL, NULL, 1, 0, 0, NULL, NULL, '2025-10-08 23:31:28.252672'),
('3b55ab08-c825-4770-b07b-a2dacb05bba5', '4c041e2b-0c48-49eb-a53f-5acf21be59a1', 'Visibility', 35.00, NULL, NULL, NULL, NULL, NULL, 1, 0, '2025-10-08 23:32:24.863427'),
('4a3e4c3c-1245-4824-b2cf-d3d8c605db66', '4c041e2b-0c48-49eb-a53f-5acf21be59a1', 'Sentiment', 50.00, NULL, NULL, 0, 1, 0, NULL, NULL, '2025-10-08 23:32:24.450561'),
('54b90355-973a-439d-bece-d4a25badf866', '8ca42294-7675-4821-a5b9-2ce3fa4d0847', 'Position', 100.00, 1.00, 1.00, NULL, NULL, NULL, NULL, NULL, '2025-10-08 23:31:28.252928'),
('54e54d5b-37f4-41d4-946c-4630133ae23d', '43a2b367-c13d-4ac5-8844-0520caa13814', 'Visibility', 0.00, NULL, NULL, NULL, NULL, NULL, 0, 0, '2025-10-08 23:34:01.199342'),
('63dda0ae-f029-4dcc-8d4d-65806346535f', '4c041e2b-0c48-49eb-a53f-5acf21be59a1', 'Position', 77.00, 2.00, 1.00, NULL, NULL, NULL, NULL, NULL, '2025-10-08 23:32:24.452066'),
('665cefbf-7b8e-447b-bdb7-8edec835eee3', '499a3fcc-7e95-4e85-a22c-3b51816a18ca', 'Sentiment', 81.35, NULL, NULL, 2, 0, 0, NULL, NULL, '2025-10-08 21:52:18.248072'),
('6e4c9181-3302-4873-a5de-59c86eacf439', '499a3fcc-7e95-4e85-a22c-3b51816a18ca', 'Visibility', 59.33, NULL, NULL, NULL, NULL, NULL, 2, 0, '2025-10-08 21:52:18.247654'),
('7356e2e2-6c63-4ca6-953a-16d81f8f1b68', 'fe5460a3-0ade-4ce0-8c73-409e44212a0f', 'Position', 0.00, 0.00, NULL, NULL, NULL, NULL, NULL, NULL, '2025-10-08 23:33:01.739977'),
('b2579e52-ff61-4452-b2e4-46bd41ddd239', '499a3fcc-7e95-4e85-a22c-3b51816a18ca', 'Position', 64.00, 4.00, 1.00, NULL, NULL, NULL, NULL, NULL, '2025-10-08 21:52:17.84778'),
('c1e877ff-c6cf-4917-bad5-41059a07df68', 'fe5460a3-0ade-4ce0-8c73-409e44212a0f', 'Sentiment', 0.00, NULL, NULL, 0, 0, 0, NULL, NULL, '2025-10-08 23:33:01.739762'),
('cad6446a-54ca-4cb2-b385-f9e4810febf2', '43a2b367-c13d-4ac5-8844-0520caa13814', 'Sentiment', 0.00, NULL, NULL, 0, 0, 0, NULL, NULL, '2025-10-08 23:34:00.793786'),
('d9c38a65-6c83-4f53-adea-48046465d661', '5483141a-3ece-41c3-90d8-6736b70f024a', 'Position', 74.00, 2.00, 1.00, NULL, NULL, NULL, NULL, NULL, '2025-10-08 23:25:58.191173'),
('e701f5d3-1871-40c1-80c3-80734eaeb2e5', 'fe5460a3-0ade-4ce0-8c73-409e44212a0f', 'Visibility', 0.00, NULL, NULL, NULL, NULL, NULL, 0, 0, '2025-10-08 23:33:01.740137'),
('e73750e7-d314-45e1-aa7e-206dce938646', '5483141a-3ece-41c3-90d8-6736b70f024a', 'Visibility', 61.33, NULL, NULL, NULL, NULL, NULL, 3, 0, '2025-10-08 23:25:58.596112')
ON CONFLICT (id) DO NOTHING;
*/

-- This table should remain empty in production until actual prompt runs are executed.
SELECT 'score_factors should NOT be seeded - it contains run-specific results data' AS notice;
