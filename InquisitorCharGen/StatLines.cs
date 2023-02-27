using System.Collections.Generic;
public class StatLines {
    private int[][] blank = {
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0},
        new int[] {0, 0, 0}
    };
    private int[][] fighter = {
        new int[] {60, 2, 10},
        new int[] {40, 2, 10},
        new int[] {50, 2, 10},
        new int[] {50, 2, 10},
        new int[] {60, 2, 10},
        new int[] {50, 2, 10},
        new int[] {50, 2, 10},
        new int[] {65, 2, 10},
        new int[] {65, 2, 10}
    };

    // Variables
    public Dictionary<int, StatBlock> statlist;

    public StatLines() {
        statlist = new Dictionary<int, StatBlock>();
        statlist.Add(0, new StatBlock("blank", 0, blank));
        statlist.Add(1, new StatBlock("fighter", 1, fighter));
    }
    public StatBlock GetStats(int id) {
        return statlist.GetValueOrDefault(id);
    }
}

public class StatBlock {
    string name;
    int id;
    Dictionary<string, int[]> stats;

    public StatBlock(string name, int id, int[][] stats) {
        this.name = name;
        this.id = id;
        this.stats = new Dictionary<string, int[]>();
        this.stats.Add("WS", stats[0]);
        this.stats.Add("BS", stats[1]);
        this.stats.Add("S", stats[2]);
        this.stats.Add("T", stats[3]);
        this.stats.Add("I", stats[4]);
        this.stats.Add("Wp", stats[5]);
        this.stats.Add("Sg", stats[6]);
        this.stats.Add("Nv", stats[7]);
        this.stats.Add("Ld", stats[8]);
    }

    public string GetName() {
        return name;
    }

    public int GetId() {
        return id;
    }

    public Dictionary<string, int[]> GetStats() {
        return stats;
    }
}