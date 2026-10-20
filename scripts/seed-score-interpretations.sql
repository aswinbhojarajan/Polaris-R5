-- ==================================================
-- SCORE INTERPRETATIONS - Production Seed Data
-- ==================================================
-- This defines human-readable interpretations for score ranges
-- across Visibility, Sentiment, and Position metrics
-- ==================================================

-- Clear existing data (optional - remove if you want to preserve existing data)
-- TRUNCATE TABLE score_interpretations CASCADE;

-- Insert score interpretation templates
INSERT INTO score_interpretations (id, category, score_min, score_max, message_template) VALUES

-- Visibility Interpretations (0-100)

('9863649a-dd90-430f-a323-17fe0e15ec27', 'Visibility', 10.00, 25.00, 
 'A score of X.X suggests Low visibility — the brand is emerging in relevant spaces, gaining limited traction with select audiences against benchmark, supported by AA mentions and BB heading hits reflecting initial reach.'),

('e595cea5-4e0c-41b3-8873-b8273ece26a2', 'Visibility', 25.00, 35.00, 
 'A score of X.X suggests Developing visibility — gaining moderate recognition within specific channels or audience segments against benchmark, driven by AA mentions and BB heading hits showing early growth in awareness.'),

('3b620964-efe8-4eb5-852d-e82ae27502f7', 'Visibility', 35.00, 55.00, 
 'A score of X.X suggests Emerging visibility — gaining some traction; moderate recognition in select audiences or channels against benchmark, driven by AA mentions and BB heading hits showing healthy reach.'),

('11275361-b821-46cb-9b05-f8c05ce4a74b', 'Visibility', 55.00, 75.00, 
 'A score of X.X suggests Strong visibility — consistent brand presence across channels with high engagement and recall against benchmark, supported by AA mentions and BB heading hits reflecting sustained reach and influence.'),

('fa72ad03-0ed1-4acd-ab40-815798e64149', 'Visibility', 75.00, 100.01, 
 'A score of X.X suggests Dominant visibility — leading share of attention and strong recognition across markets and media against benchmark, driven by AA mentions and BB heading hits indicating extensive reach and top-tier prominence.'),

-- Sentiment Interpretations (0-100)
('22186191-a028-45c6-a4dc-c746c73ea983', 'Sentiment', 0.00, 10.00, 
 'A score of X.X suggests Severely negative sentiment — overall discussion around the brand is unfavorable, dominated by criticism or dissatisfaction against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions indicating strong negativity.'),

('93812372-7e3d-46fe-af04-8627dab54fc9', 'Sentiment', 10.00, 25.00, 
 'A score of X.X suggests Predominantly negative sentiment — brand perception skews negative, though occasional neutral or positive mentions appear against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions reflecting weak advocacy.'),

('57dcd8e5-b9b0-4630-ada5-c3799677740b', 'Sentiment', 25.00, 35.00, 
 'A score of X.X suggests Cautious sentiment — mixed reactions with a noticeable tilt toward negative tone, highlighting underlying concerns against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions showing a balance leaning negative.'),

('1b277f5b-08d8-4e08-a333-980caf7745f8', 'Sentiment', 35.00, 55.00, 
 'A score of X.X suggests Balanced sentiment — opinions are mixed, with comparable positive and negative mentions against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions indicating a neutral-to-slightly-positive perception.'),

('e0f2ac37-9a94-4af8-9058-2f6478975c67', 'Sentiment', 55.00, 75.00, 
 'A score of X.X suggests Positive sentiment — favorable discussion dominates, showing growing trust and satisfaction against benchmark, driven by AA positive mentions, BB neutral mentions, and CC negative mentions reflecting supportive tone.'),

('46fdf33c-2d7f-4ac2-bd10-2c3fb8cc6967', 'Sentiment', 75.00, 100.01, 
 'A score of X.X suggests Highly positive sentiment — brand enjoys strong advocacy and goodwill across audiences against benchmark, with AA positive mentions, BB neutral mentions, and CC negative mentions highlighting overwhelmingly positive perception.'),

-- Position Interpretations (0-100)
('69f8c047-281d-4825-b2b1-5dcd4385cc5d', 'Position', 0.00, 10.00, 
 'A score of X.X suggests Minimal market presence — the brand ranks very low against peers with limited visibility or differentiation, supported by AA relevance and a position score of BB, indicating low competitive standing.'),

('9c6d4cc7-cb2b-41df-8f02-3a234cea53ce', 'Position', 10.00, 25.00, 
 'A score of X.X suggests Weak positioning — limited traction versus competitors and low association with key themes; with AA relevance and a position score of BB reflect the need for stronger market alignment.'),

('4d0e807b-c5a0-4741-a0c9-8aa94ed669bd', 'Position', 25.00, 35.00, 
 'A score of X.X suggests Developing position — emerging competitiveness and improving visibility in select areas; with AA relevance and a position score of BB show gradual movement toward category recognition.'),

('199719de-ba51-449d-8d5e-5f8a646fba8b', 'Position', 35.00, 55.00, 
 'A score of X.X suggests Moderate positioning — stable but not leading, with consistent presence across key themes; with AA relevance and a position score of BB highlight steady but improvable market alignment.'),

('3874d1e2-0049-4b72-bc89-ce25ba13be70', 'Position', 55.00, 75.00, 
 'A score of X.X suggests Strong position — solid market standing and clear association with key topics; with AA relevance and a position score of BB indicate favorable differentiation and competitive strength.'),

('faad5ea0-a3e0-455b-9d11-9979ecc7cb49', 'Position', 75.00, 100.01, 
 'A score of X.X suggests Leading position — the brand ranks among top performers with dominant presence and strong relevance across strategic areas; with AA relevance and a position score of BB signal clear market leadership.')

ON CONFLICT (id) DO NOTHING;

-- Verify the data
SELECT category, score_min, score_max, 
       LEFT(message_template, 50) || '...' AS message_preview
FROM score_interpretations 
ORDER BY category, score_min;
