#!/bin/bash

# Example macOS IPA signing script for private distribution
# Usage: ./sign_ipa.sh <input_ipa> <output_ipa> <cert_name> <mobileprovision>

INPUT_IPA=$1
OUTPUT_IPA=$2
CERT_NAME=$3
PROFILE=$4

if [[ -z "$PROFILE" ]]; then
  echo "Usage: ./sign_ipa.sh <input_ipa> <output_ipa> <cert_name> <mobileprovision>"
  exit 1
fi

TEMP_DIR="temp_signing_$(date +%s)"
mkdir -p "$TEMP_DIR"

echo "[1/4] Unzipping IPA..."
unzip -q "$INPUT_IPA" -d "$TEMP_DIR"

APP_DIR=$(ls -d "$TEMP_DIR"/Payload/*.app)

echo "[2/4] Replacing Provisioning Profile..."
cp "$PROFILE" "$APP_DIR/embedded.mobileprovision"
rm -rf "$APP_DIR/_CodeSignature"

echo "[3/4] Signing with codesign..."
codesign -f -s "$CERT_NAME" "$APP_DIR"

echo "[4/4] Packing new IPA..."
cd "$TEMP_DIR" || exit
zip -qr "../$OUTPUT_IPA" Payload
cd ..

rm -rf "$TEMP_DIR"
echo "Done! Signed IPA saved to $OUTPUT_IPA"
