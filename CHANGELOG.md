# Changelog

All notable changes to Waves will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
versioning loosely follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Pengujian menyeluruh fitur Image / Video / LLM / Coder sebelum release stabil
- Dokumentasi vendor fork lebih lengkap dan arsitektur
- Release versi stabil `v1.2.0-stable` setelah QA

## [1.1.5-preview] - 2026-09-23

### Added
- Sponsorship: `.github/FUNDING.yml` (GitHub Sponsors `KiRaRyuuKi` + Saweria `saweria.co/KiRaRyuuKi`)
- Sidebar: link Saweria diperbaiki label `Saweria`, sponsor diperbaiki `github.com/sponsors/KiRaRyuuKi` (`Sidebar.tsx`)
- Governance open-source awal: `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates

### Changed
- Video/Image pipeline dan SetupModal disetel ulang (dari commit sebelumnya)
- Dokumentasi vendor fork ditambahkan ringkas di `README.md`

### Fixed
- Status `Terpasang` model Image/Video di SetupModal
- ETA dan kecepatan unduh Setup yang live

## [1.0.5-beta] - 2026-09-21

### Added
- AnimateDiff single-task (`animate-diff`) dan Wan T2V `1.3B`
- Setup live ETA dan kecepatan internet via disk polling
- `ServerControl` & `SetupModal` untuk manajemen model runtime

## [0.1.5-alpha] - 2026-09-20

- Rilis awal: Stem Separator (Demucs), Voice Synthesis (VITS), Fine-tune, Image/Video generation, Web Audio mixer
