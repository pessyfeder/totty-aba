-- "Incentives" are called "reinforcements" in the product.
ALTER TABLE incentive RENAME TO reinforcement;
ALTER INDEX incentive_client_idx RENAME TO reinforcement_client_idx;
