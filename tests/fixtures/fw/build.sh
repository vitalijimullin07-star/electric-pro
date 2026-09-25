#!/bin/sh
# Сборка тестовых прошивок (нужен avr-gcc): sh tests/fixtures/fw/build.sh
cd "$(dirname "$0")"
for f in *.c; do
  n="${f%.c}"
  avr-gcc -mmcu=atmega328p -DF_CPU=16000000UL -Os -o "$n.elf" "$f" && avr-objcopy -O ihex -R .eeprom "$n.elf" "$n.hex" && rm "$n.elf" || exit 1
done
