-- Intake uploads (SPEC 5.1a step 3, 5.7b): the returned form and documents are attached to the client.
-- `data` is AES-256-GCM ciphertext (iv || tag || ciphertext); plaintext never reaches the database (SPEC 5.1a, 8).
CREATE TABLE client_document (
    id            uuid PRIMARY KEY,
    client_id     uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    kind          text NOT NULL CHECK (kind IN ('form', 'document')),
    filename      text NOT NULL,
    content_type  text NOT NULL,
    size_bytes    integer NOT NULL CHECK (size_bytes > 0),
    data          bytea NOT NULL,
    uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_document_client_idx ON client_document (client_id, uploaded_at DESC);
