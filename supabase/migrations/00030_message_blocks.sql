CREATE TABLE IF NOT EXISTS message_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  recipient_id UUID NOT NULL,
  message_preview TEXT,
  block_reason TEXT NOT NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_blocks_sender ON message_blocks(sender_id);
