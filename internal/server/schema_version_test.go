package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yuki9431/catalyzer/internal/pipeline"
)

func TestHandleSchemaVersion(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/schema-version", nil)
	rec := httptest.NewRecorder()
	handleSchemaVersion(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body struct {
		SchemaVersion int `json:"schema_version"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if body.SchemaVersion != pipeline.MatchDataSchemaVersion {
		t.Errorf("expected schema_version=%d, got %d", pipeline.MatchDataSchemaVersion, body.SchemaVersion)
	}
}
