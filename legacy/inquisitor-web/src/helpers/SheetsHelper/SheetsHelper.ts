import Papa from "papaparse";

export const sheetUrlToCsv = async (url: string): Promise<{[key: string]: string}[]> => {
    try {
        const res = await fetch(url, {
            method: "get",
            headers: {
                "content-type": "text/csv;charset=UTF-8",
            },
        });

        if (res.status === 200) {
            const data = await res.text();
            const parsed = Papa.parse(data, { header: true }).data;
            return parsed as {[key: string]: string}[];
        } else {
            console.error(`Error code ${res.status}`);
            return [];
        }
    } catch (err) {
        console.error(err);
        return [];
    }
};
