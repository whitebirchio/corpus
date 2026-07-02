import type { Db } from "../db/client.js";
import { movements } from "../db/schema.js";

type Category =
  | "squat"
  | "hinge"
  | "press"
  | "pull"
  | "carry"
  | "olympic"
  | "core"
  | "monostructural"
  | "plyo"
  | "other";

interface SeedMovement {
  name: string;
  aliases?: string[];
  category: Category;
  primary: string[];
  secondary?: string[];
  equipment?: string[];
}

/**
 * Muscle-group vocabulary (keep controlled — analysis groups by these):
 * chest, front_delts, side_delts, rear_delts, triceps, biceps, forearms,
 * lats, upper_back, traps, lower_back, core, obliques, glutes, quads,
 * hamstrings, adductors, calves, hip_flexors, full_body, cardio.
 */
export const MOVEMENT_SEED: SeedMovement[] = [
  // --- squat pattern ---
  { name: "back squat", category: "squat", primary: ["quads", "glutes"], secondary: ["core", "lower_back"], equipment: ["barbell"] },
  { name: "front squat", category: "squat", primary: ["quads", "glutes"], secondary: ["core", "upper_back"], equipment: ["barbell"] },
  { name: "overhead squat", category: "squat", primary: ["quads", "glutes"], secondary: ["core", "side_delts", "upper_back"], equipment: ["barbell"] },
  { name: "goblet squat", category: "squat", primary: ["quads", "glutes"], secondary: ["core"], equipment: ["dumbbell", "kettlebell"] },
  { name: "air squat", aliases: ["bodyweight squat"], category: "squat", primary: ["quads", "glutes"] },
  { name: "pistol squat", aliases: ["single leg squat"], category: "squat", primary: ["quads", "glutes"], secondary: ["core"] },
  { name: "leg press", category: "squat", primary: ["quads", "glutes"], equipment: ["machine"] },
  { name: "walking lunge", aliases: ["lunge"], category: "squat", primary: ["quads", "glutes"], secondary: ["hamstrings", "core"] },
  { name: "reverse lunge", category: "squat", primary: ["quads", "glutes"], secondary: ["hamstrings"] },
  { name: "bulgarian split squat", aliases: ["rear foot elevated split squat"], category: "squat", primary: ["quads", "glutes"], secondary: ["adductors"], equipment: ["dumbbell"] },
  { name: "step up", category: "squat", primary: ["quads", "glutes"], equipment: ["box"] },
  { name: "wall ball", aliases: ["wall ball shot"], category: "squat", primary: ["quads", "glutes", "front_delts"], secondary: ["core"], equipment: ["medicine ball"] },
  { name: "thruster", category: "squat", primary: ["quads", "glutes", "front_delts"], secondary: ["triceps", "core"], equipment: ["barbell", "dumbbell"] },
  { name: "leg extension", category: "squat", primary: ["quads"], equipment: ["machine"] },

  // --- hinge pattern ---
  { name: "deadlift", aliases: ["conventional deadlift"], category: "hinge", primary: ["hamstrings", "glutes", "lower_back"], secondary: ["traps", "forearms", "core"], equipment: ["barbell"] },
  { name: "romanian deadlift", aliases: ["rdl"], category: "hinge", primary: ["hamstrings", "glutes"], secondary: ["lower_back"], equipment: ["barbell", "dumbbell"] },
  { name: "sumo deadlift", category: "hinge", primary: ["glutes", "hamstrings", "adductors"], secondary: ["lower_back", "traps"], equipment: ["barbell"] },
  { name: "single leg romanian deadlift", aliases: ["single leg rdl"], category: "hinge", primary: ["hamstrings", "glutes"], secondary: ["core"], equipment: ["dumbbell", "kettlebell"] },
  { name: "kettlebell swing", aliases: ["russian kettlebell swing", "american kettlebell swing"], category: "hinge", primary: ["glutes", "hamstrings"], secondary: ["core", "front_delts"], equipment: ["kettlebell"] },
  { name: "good morning", category: "hinge", primary: ["hamstrings", "lower_back"], secondary: ["glutes"], equipment: ["barbell"] },
  { name: "hip thrust", aliases: ["barbell hip thrust", "glute bridge"], category: "hinge", primary: ["glutes"], secondary: ["hamstrings"], equipment: ["barbell"] },
  { name: "back extension", aliases: ["hyperextension"], category: "hinge", primary: ["lower_back", "glutes"], secondary: ["hamstrings"], equipment: ["ghd"] },
  { name: "leg curl", aliases: ["hamstring curl"], category: "hinge", primary: ["hamstrings"], equipment: ["machine"] },

  // --- press pattern ---
  { name: "bench press", aliases: ["barbell bench press", "flat bench"], category: "press", primary: ["chest", "triceps", "front_delts"], equipment: ["barbell", "bench"] },
  { name: "incline bench press", aliases: ["incline press"], category: "press", primary: ["chest", "front_delts", "triceps"], equipment: ["barbell", "bench"] },
  { name: "dumbbell bench press", aliases: ["db bench"], category: "press", primary: ["chest", "triceps", "front_delts"], equipment: ["dumbbell", "bench"] },
  { name: "close grip bench press", category: "press", primary: ["triceps", "chest"], equipment: ["barbell", "bench"] },
  { name: "overhead press", aliases: ["strict press", "shoulder press", "military press"], category: "press", primary: ["front_delts", "side_delts", "triceps"], secondary: ["core", "upper_back"], equipment: ["barbell"] },
  { name: "dumbbell shoulder press", aliases: ["db shoulder press", "seated dumbbell press"], category: "press", primary: ["front_delts", "side_delts", "triceps"], equipment: ["dumbbell"] },
  { name: "push press", category: "press", primary: ["front_delts", "triceps"], secondary: ["quads", "glutes", "core"], equipment: ["barbell"] },
  { name: "push jerk", category: "press", primary: ["front_delts", "triceps"], secondary: ["quads", "glutes", "core"], equipment: ["barbell"] },
  { name: "split jerk", category: "press", primary: ["front_delts", "triceps"], secondary: ["quads", "glutes", "core"], equipment: ["barbell"] },
  { name: "push up", aliases: ["pushup", "press up"], category: "press", primary: ["chest", "triceps", "front_delts"], secondary: ["core"] },
  { name: "handstand push up", aliases: ["hspu"], category: "press", primary: ["front_delts", "triceps"], secondary: ["traps", "core"] },
  { name: "dip", aliases: ["ring dip", "bar dip"], category: "press", primary: ["chest", "triceps"], secondary: ["front_delts"], equipment: ["rings", "bars"] },
  { name: "lateral raise", aliases: ["side raise", "dumbbell lateral raise"], category: "press", primary: ["side_delts"], equipment: ["dumbbell"] },
  { name: "triceps pushdown", aliases: ["cable pushdown", "tricep extension"], category: "press", primary: ["triceps"], equipment: ["cable"] },

  // --- pull pattern ---
  { name: "pull up", aliases: ["pullup", "strict pull up", "kipping pull up"], category: "pull", primary: ["lats", "biceps"], secondary: ["upper_back", "forearms", "core"], equipment: ["bar"] },
  { name: "chin up", aliases: ["chinup"], category: "pull", primary: ["lats", "biceps"], secondary: ["upper_back"], equipment: ["bar"] },
  { name: "chest to bar pull up", aliases: ["c2b", "chest to bar"], category: "pull", primary: ["lats", "biceps"], secondary: ["upper_back"], equipment: ["bar"] },
  { name: "muscle up", aliases: ["bar muscle up", "ring muscle up"], category: "pull", primary: ["lats", "chest", "triceps"], secondary: ["core", "biceps"], equipment: ["rings", "bar"] },
  { name: "ring row", aliases: ["inverted row", "bodyweight row"], category: "pull", primary: ["upper_back", "lats", "biceps"], equipment: ["rings"] },
  { name: "barbell row", aliases: ["bent over row", "pendlay row"], category: "pull", primary: ["upper_back", "lats"], secondary: ["biceps", "lower_back"], equipment: ["barbell"] },
  { name: "dumbbell row", aliases: ["single arm row", "db row"], category: "pull", primary: ["lats", "upper_back"], secondary: ["biceps"], equipment: ["dumbbell"] },
  { name: "lat pulldown", category: "pull", primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: ["cable"] },
  { name: "seated cable row", aliases: ["cable row"], category: "pull", primary: ["upper_back", "lats"], secondary: ["biceps"], equipment: ["cable"] },
  { name: "face pull", category: "pull", primary: ["rear_delts", "upper_back"], equipment: ["cable"] },
  { name: "biceps curl", aliases: ["barbell curl", "dumbbell curl", "curl"], category: "pull", primary: ["biceps"], equipment: ["barbell", "dumbbell"] },
  { name: "hammer curl", category: "pull", primary: ["biceps", "forearms"], equipment: ["dumbbell"] },
  { name: "rope climb", category: "pull", primary: ["lats", "biceps", "forearms"], secondary: ["core"], equipment: ["rope"] },
  { name: "shrug", aliases: ["barbell shrug", "dumbbell shrug"], category: "pull", primary: ["traps"], equipment: ["barbell", "dumbbell"] },

  // --- olympic ---
  { name: "clean", aliases: ["squat clean"], category: "olympic", primary: ["quads", "glutes", "traps"], secondary: ["hamstrings", "core", "front_delts"], equipment: ["barbell"] },
  { name: "power clean", category: "olympic", primary: ["glutes", "hamstrings", "traps"], secondary: ["quads", "core"], equipment: ["barbell"] },
  { name: "hang clean", aliases: ["hang power clean"], category: "olympic", primary: ["glutes", "traps"], secondary: ["quads", "core"], equipment: ["barbell"] },
  { name: "snatch", aliases: ["squat snatch"], category: "olympic", primary: ["quads", "glutes", "traps"], secondary: ["side_delts", "core", "upper_back"], equipment: ["barbell"] },
  { name: "power snatch", category: "olympic", primary: ["glutes", "hamstrings", "traps"], secondary: ["side_delts", "core"], equipment: ["barbell"] },
  { name: "clean and jerk", category: "olympic", primary: ["quads", "glutes", "front_delts"], secondary: ["traps", "triceps", "core"], equipment: ["barbell"] },
  { name: "dumbbell snatch", category: "olympic", primary: ["glutes", "hamstrings", "front_delts"], secondary: ["core"], equipment: ["dumbbell"] },

  // --- core ---
  { name: "plank", category: "core", primary: ["core"] },
  { name: "sit up", aliases: ["situp", "abmat sit up"], category: "core", primary: ["core", "hip_flexors"] },
  { name: "ghd sit up", category: "core", primary: ["core", "hip_flexors"], equipment: ["ghd"] },
  { name: "toes to bar", aliases: ["t2b"], category: "core", primary: ["core", "hip_flexors"], secondary: ["lats", "forearms"], equipment: ["bar"] },
  { name: "knees to elbows", aliases: ["knee raise", "hanging knee raise"], category: "core", primary: ["core", "hip_flexors"], equipment: ["bar"] },
  { name: "hollow hold", aliases: ["hollow rock"], category: "core", primary: ["core"] },
  { name: "russian twist", category: "core", primary: ["obliques", "core"] },
  { name: "ab wheel rollout", aliases: ["ab wheel"], category: "core", primary: ["core"], secondary: ["lats"], equipment: ["ab wheel"] },
  { name: "l sit", category: "core", primary: ["core", "hip_flexors"], secondary: ["triceps"] },

  // --- carries ---
  { name: "farmer carry", aliases: ["farmers walk", "farmer walk"], category: "carry", primary: ["forearms", "traps", "core"], equipment: ["dumbbell", "kettlebell"] },
  { name: "sandbag carry", category: "carry", primary: ["core", "upper_back", "full_body"], equipment: ["sandbag"] },
  { name: "suitcase carry", category: "carry", primary: ["obliques", "forearms", "core"], equipment: ["dumbbell", "kettlebell"] },

  // --- monostructural / cardio ---
  { name: "run", aliases: ["running", "jog"], category: "monostructural", primary: ["cardio", "quads", "hamstrings", "calves"] },
  { name: "row", aliases: ["rowing", "erg"], category: "monostructural", primary: ["cardio", "upper_back", "quads", "hamstrings"], equipment: ["rower"] },
  { name: "bike", aliases: ["assault bike", "echo bike", "air bike", "cycling"], category: "monostructural", primary: ["cardio", "quads"], equipment: ["bike"] },
  { name: "ski erg", aliases: ["ski"], category: "monostructural", primary: ["cardio", "lats", "core"], equipment: ["ski erg"] },
  { name: "double under", aliases: ["double unders", "du"], category: "monostructural", primary: ["cardio", "calves"], equipment: ["jump rope"] },
  { name: "single under", aliases: ["jump rope"], category: "monostructural", primary: ["cardio", "calves"], equipment: ["jump rope"] },
  { name: "swim", aliases: ["swimming"], category: "monostructural", primary: ["cardio", "lats", "full_body"] },
  { name: "ruck", aliases: ["rucking"], category: "monostructural", primary: ["cardio", "quads", "core"], equipment: ["ruck"] },

  // --- plyo / other ---
  { name: "box jump", category: "plyo", primary: ["quads", "glutes", "calves"], equipment: ["box"] },
  { name: "box jump over", category: "plyo", primary: ["quads", "glutes", "calves"], equipment: ["box"] },
  { name: "broad jump", category: "plyo", primary: ["glutes", "quads"] },
  { name: "burpee", aliases: ["burpees"], category: "plyo", primary: ["full_body", "cardio"], secondary: ["chest", "quads", "core"] },
  { name: "burpee box jump over", category: "plyo", primary: ["full_body", "cardio"], equipment: ["box"] },
  { name: "sled push", aliases: ["prowler push"], category: "other", primary: ["quads", "glutes", "calves"], secondary: ["core"], equipment: ["sled"] },
  { name: "sled drag", category: "other", primary: ["hamstrings", "glutes"], equipment: ["sled"] },
  { name: "turkish get up", aliases: ["tgu"], category: "other", primary: ["core", "front_delts", "full_body"], equipment: ["kettlebell"] },
];

/** Idempotent: safe to run on every deploy. */
export async function seedMovements(db: Db): Promise<{ inserted: number; total: number }> {
  let inserted = 0;
  for (const m of MOVEMENT_SEED) {
    const rows = await db
      .insert(movements)
      .values({
        name: m.name,
        aliases: m.aliases ?? [],
        category: m.category,
        primaryMuscles: m.primary,
        secondaryMuscles: m.secondary ?? [],
        equipment: m.equipment ?? [],
        verified: true,
      })
      .onConflictDoNothing({ target: movements.name })
      .returning();
    if (rows.length > 0) inserted += 1;
  }
  return { inserted, total: MOVEMENT_SEED.length };
}
