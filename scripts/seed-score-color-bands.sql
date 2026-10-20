-- ==================================================
-- SCORE COLOR BANDS - Production Seed Data
-- ==================================================
-- This defines the color-coding thresholds for scores
-- across Visibility, Sentiment, and Position metrics
-- ==================================================

-- Clear existing data (optional - remove if you want to preserve existing data)
-- TRUNCATE TABLE score_color_bands CASCADE;

-- Insert score color bands configuration
INSERT INTO score_color_bands (id, category, band_name, color_hex, score_min, score_max) VALUES
-- Visibility Bands
('e1ce0124-584d-441e-9859-42bc30def983', 'Visibility', 'Red', '#EF4444', 0.00, 30.01),
('b75b2d40-ae5a-4db8-847d-96cd74b5044c', 'Visibility', 'Amber', '#F59E0B', 30.01, 70.01),
('d482d2c1-88b0-4d32-b35b-450a8cb071b2', 'Visibility', 'Green', '#10B981', 70.01, 100.01),

-- Sentiment Bands
('dbfa791f-1e74-421c-a349-c98320ce3506', 'Sentiment', 'Red', '#EF4444', 0.00, 30.01),
('ef093238-9de4-4a19-87ed-62d29c9cfd2d', 'Sentiment', 'Amber', '#F59E0B', 30.01, 70.01),
('3bde8d08-5cee-418d-8b7a-aaf880961143', 'Sentiment', 'Green', '#10B981', 70.01, 100.01),

-- Position Bands
('5d97b881-e484-4db2-824e-ef4d3e388710', 'Position', 'Red', '#EF4444', 0.00, 30.01),
('ac2466f5-829e-4757-a687-1c80258af77c', 'Position', 'Amber', '#F59E0B', 30.01, 70.01),
('0e10b956-e608-4c08-96f8-ebca2f29c364', 'Position', 'Green', '#10B981', 70.01, 100.01)
ON CONFLICT (id) DO NOTHING;

-- Verify the data
SELECT category, band_name, color_hex, score_min, score_max 
FROM score_color_bands 
ORDER BY category, score_min;
