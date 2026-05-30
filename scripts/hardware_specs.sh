#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART_DIR="${REPO_ROOT}/artifacts"
SHOTS_DIR="${ART_DIR}/screenshots"
OUT="${ART_DIR}/hardware.json"

mkdir -p "${ART_DIR}" "${SHOTS_DIR}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "hardware_specs.sh: macOS-only (detected $(uname -s))" >&2
  exit 2
fi

hw_raw="$(system_profiler SPHardwareDataType 2>/dev/null || true)"
disp_raw="$(system_profiler SPDisplaysDataType 2>/dev/null || true)"
sw_raw="$(sw_vers 2>/dev/null || true)"
storage_raw="$(system_profiler SPStorageDataType 2>/dev/null || true)"

field() {
  local src="$1" key="$2"
  printf '%s\n' "${src}" | awk -F': *' -v k="${key}" '
    $0 ~ k":" { sub(/^[ \t]+/, "", $2); sub(/[ \t\r\n]+$/, "", $2); print $2; exit }
  ' | tr -d '\n\r'
}

model_name="$(field "${hw_raw}" 'Model Name')"
model_identifier="$(field "${hw_raw}" 'Model Identifier')"
chip="$(field "${hw_raw}" 'Chip')"
processor_name="$(field "${hw_raw}" 'Processor Name')"
total_cores="$(field "${hw_raw}" 'Total Number of Cores')"
memory="$(field "${hw_raw}" 'Memory')"
serial="$(field "${hw_raw}" 'Serial Number (system)')"
hw_uuid="$(field "${hw_raw}" 'Hardware UUID')"

gpu_chipset="$(field "${disp_raw}" 'Chipset Model')"
gpu_cores="$(field "${disp_raw}" 'Total Number of Cores')"
gpu_vendor="$(field "${disp_raw}" 'Vendor')"
gpu_metal="$(field "${disp_raw}" 'Metal Support')"

os_name="$(field "${sw_raw}" 'ProductName')"
os_version="$(field "${sw_raw}" 'ProductVersion')"
os_build="$(field "${sw_raw}" 'BuildVersion')"

node_version="$(node --version 2>/dev/null || echo 'not-installed')"
npm_version="$(npm --version 2>/dev/null || echo 'not-installed')"

storage_summary=""
if [[ -n "${storage_raw}" ]]; then
  storage_summary="$(printf '%s\n' "${storage_raw}" | awk -F': *' '
    /Capacity:/ { sub(/^[ \t]+/, "", $2); sub(/[ \t\r]+$/, "", $2); cap=$2 }
    /Free:/    { sub(/^[ \t]+/, "", $2); sub(/[ \t\r]+$/, "", $2); free=$2 }
    END { if (cap != "") printf "%s capacity, %s free", cap, free }
  ' | tr -d '\n\r')"
fi

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

cat >"${OUT}" <<JSON
{
  "captured_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "host": {
    "model_name": $(json_escape "${model_name}"),
    "model_identifier": $(json_escape "${model_identifier}"),
    "chip": $(json_escape "${chip:-${processor_name}}"),
    "cpu_cores": $(json_escape "${total_cores}"),
    "memory": $(json_escape "${memory}"),
    "serial_redacted": "REDACTED",
    "hw_uuid_redacted": "REDACTED"
  },
  "gpu": {
    "chipset": $(json_escape "${gpu_chipset}"),
    "cores": $(json_escape "${gpu_cores}"),
    "vendor": $(json_escape "${gpu_vendor}"),
    "metal_support": $(json_escape "${gpu_metal}")
  },
  "os": {
    "name": $(json_escape "${os_name}"),
    "version": $(json_escape "${os_version}"),
    "build": $(json_escape "${os_build}")
  },
  "runtime": {
    "node": $(json_escape "${node_version}"),
    "npm": $(json_escape "${npm_version}")
  },
  "storage": $(json_escape "${storage_summary}"),
  "_note": "Serial and UUID redacted on purpose. Re-capture without redaction only for private audit."
}
JSON

echo "wrote ${OUT}"
echo ""
echo "Next: capture the About-This-Mac screenshot yourself."
echo "  1. Apple menu > About This Mac"
echo "  2. In a new terminal, run:"
echo "       screencapture -i \"${SHOTS_DIR}/about-mac.png\""
echo "  3. Click the About-This-Mac window when the camera cursor appears."
echo ""
echo "Optional second shot (System Information > Hardware overview):"
echo "  screencapture -i \"${SHOTS_DIR}/system-info-hardware.png\""
