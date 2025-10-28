# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-10-27

### Added
- Initial release of Temporal Graph MCP Server
- Document management (add, get, list, delete)
- Relationship management (add, get neighbors, find path)
- Semantic search using vector embeddings (@xenova/transformers)
- Full-text search using SQLite FTS5
- Graph statistics and export functionality
- 9 MCP tools for Claude Desktop integration
- Comprehensive test suite (unit and integration tests)
- Example usage scripts
- Documentation (README, installation guide)

### Features
- SQLite-based graph storage with better-sqlite3
- Optional sqlite-vec integration for vector search
- Automatic embedding generation (all-MiniLM-L6-v2, 384 dimensions)
- BFS-based path finding with configurable max depth
- Bidirectional relationship navigation
- Metadata support for nodes and edges
- JSON export for visualization tools

### Fixed
- TypeScript type compatibility issue with @xenova/transformers Pipeline type
- SQL schema file loading - embedded schema directly in code for reliable deployment
- MCP configuration path - now correctly points to dist/index.js

### Technical Details
- Node.js 20+ and TypeScript 5+
- MCP SDK integration for Claude Desktop
- Vitest for testing
- Modular architecture with clear separation of concerns

### Known Limitations
- Maximum 10,000 documents
- Maximum 2MB per document
- Fixed vector dimension (384)
- Synchronous operations (blocking)
- No embedding caching
- No temporal validation or timestamps

### Documentation
- Complete README with usage examples
- sqlite-vec installation guide
- API documentation in code
- Test coverage for core functionality

## [Unreleased]

### Planned for v0.2
- Timestamps for temporal causality
- Temporal validation (getFutureNodes, getPastNodes)
- Enhanced error handling

### Planned for v0.3
- Embedding cache for better performance
- Batch operations
- Async API

### Planned for v0.4+
- Multiple graph support
- REST API
- Graph visualization
- Import/export formats (GraphML, JSON-LD)
