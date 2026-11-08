"""Operational categories inferred only from explicit source descriptions."""
import re


def is_weather_standby(notes):
    """Recognise weather delays without matching training, drainage or normal work."""
    text = str(notes or '')
    if re.search(r'\b(?:no|not)\s+(?:wet\s+weather|weather\s+delay|rain\s+delay|lightning)\b|\bweather\s+(?:cleared|fine)\b', text, re.I):
        return False
    return bool(re.search(
        r'\b(?:wet|inclement|adverse)\s+weather\b|\blightning\b'
        r'|\bto[o]?\s+wet\s+(?:to|for)\b'
        r'|\brain(?:ing)?\b.{0,45}\b(?:delay|standby|stopped|wet)\b'
        r'|\bwet\b.{0,70}\bno\b.{0,25}\b(?:vehicle|rig)\b.{0,20}\bmovement\b',
        text, re.I,
    ))
