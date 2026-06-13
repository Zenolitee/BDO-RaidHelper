"""Recolor BDO class icons from white to class-themed colors."""
from PIL import Image
import os

# Class name -> RGB color (based on BDO class themes/elements)
CLASS_COLORS = {
    "Warrior":     (100, 149, 237),   # Steel Blue - knight
    "Ranger":      (34, 139, 34),     # Forest Green - nature
    "Sorceress":   (128, 0, 128),     # Purple - dark magic
    "Berserker":   (178, 34, 34),     # Crimson Red - rage
    "Tamer":       (255, 140, 0),     # Dark Orange - beast
    "Musa":        (139, 0, 0),       # Deep Red - Korean warrior
    "Maehwa":      (199, 21, 133),    # Medium Violet Red - elegant
    "Valkyrie":    (255, 215, 0),     # Gold - holy warrior
    "Kunoichi":    (219, 112, 147),   # Pale Violet Red - feminine ninja
    "Ninja":       (47, 47, 47),      # Dark Gray - shadow
    "Wizard":      (30, 144, 255),    # Dodger Blue - elemental
    "Witch":       (0, 206, 209),     # Dark Cyan - nature magic
    "DarkKnight":  (75, 0, 130),      # Indigo - dark energy
    "Striker":     (255, 69, 0),      # Red Orange - martial arts
    "Mystic":      (0, 206, 209),     # Turquoise - water/martial
    "Lahn":        (219, 112, 147),   # Pink Coral - dancer
    "Archer":      (169, 169, 169),   # Dark Gray - precision
    "Shai":        (255, 223, 0),     # Golden Yellow - cheerful support
    "Guardian":    (135, 206, 250),   # Light Sky Blue - frozen north
    "Hashashin":   (210, 180, 140),   # Tan - desert sands
    "Nova":        (148, 103, 189),   # Medium Purple - summoner
    "Sage":        (0, 128, 128),     # Teal - ancient knowledge
    "Corsair":     (0, 105, 148),     # Ocean Blue - pirate
    "Drakania":    (139, 0, 0),       # Dark Red - dragon
    "Woosa":       (135, 206, 235),   # Sky Blue - wind/butterfly
    "Maegu":       (255, 140, 0),     # Orange - fox spirit
    "Scholar":     (184, 115, 51),    # Bronze - alchemy
    "Dusa":        (0, 128, 0),       # Jade Green - Korean traditional
    "Deadeye":     (255, 191, 0),     # Amber - gunslinger
    "Wukong":      (255, 69, 0),      # Red Orange - Monkey King
    "Seraph":      (255, 215, 0),     # Gold - divine/angelic
}

IMAGES_DIR = os.path.join(os.path.dirname(__file__), "..", "images")

def recolor_image(img, target_rgb):
    """Recolor white pixels to target color, preserve alpha."""
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size
    
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                # Map brightness: white (255,255,255) -> target color
                brightness = (r + g + b) / (3 * 255)
                nr = int(target_rgb[0] * brightness)
                ng = int(target_rgb[1] * brightness)
                nb = int(target_rgb[2] * brightness)
                pixels[x, y] = (nr, ng, nb, a)
    
    return img

def main():
    for class_name, color in CLASS_COLORS.items():
        logo_path = os.path.join(IMAGES_DIR, class_name, "logo.png")
        if not os.path.exists(logo_path):
            print(f"SKIP: {class_name} (no logo.png)")
            continue
        
        img = Image.open(logo_path)
        recolored = recolor_image(img, color)
        recolored.save(logo_path)
        print(f"OK: {class_name} -> RGB{color}")
    
    print("\nDone!")

if __name__ == "__main__":
    main()
