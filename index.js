const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const readline = require('node:readline');


/**
 * Calculates the gross amount (brutto) by applying the appropriate tax rate to the net amount.
 * 
 * @param {number} netAmount - The net amount (before tax).
 * @param {number|string} foundTax - The tax rate to be applied, in percentage (e.g., '19' or '19.0'). If not provided, defaults to 19% for euro currency.
 * @param {string} currency - The currency symbol (e.g., '€'). Used to determine the default tax rate if no `foundTax` is provided.
 * @returns {number} The calculated gross amount, rounded to two decimal places.
 */
function calculateGrossAmount(netAmount, foundTax, currency) {
    let tax  = 0;

    if (foundTax) {
        tax  = parseFloat(foundTax);
    } else if (currency === '€') {
        tax  = 19;
    }

    const brutto = netAmount * (1 + tax  / 100);
    return brutto.toFixed(2);
}

/**
 * Validates if the provided date string matches the format "DD.MM.YYYY".
 * The day (DD) can range from 01 to 31, the month (MM) can range from 01 to 12,
 * and the year (YYYY) must be a four-digit number.
 * 
 * @param {string} dateString - The date string to be validated, in the format "DD.MM.YYYY".
 * @returns {boolean} `true` if the date string matches the expected format, `false` otherwise.
 */
function isValidDateFormat(dateString) {
    const regex = /^([0-2][0-9]|3[01])\.(0[1-9]|1[0-2])\.\d{4}$/;
    return regex.test(dateString);
}

/**
 * Formats a given date string into the "DD.MM.YYYY" format.
 * The function first checks if the date string already matches the "DD.MM.YYYY" format.
 * If it does, it returns the input date string as is.
 * If the date string doesn't match the format, it attempts to parse the string using multiple known date formats.
 * If the string can be parsed successfully, it converts the date to the "DD.MM.YYYY" format.
 * If the parsing fails, it throws an error indicating the invalid format.
 * 
 * @param {string} dateString - The date string to be formatted. Can be in various formats such as 
 *                              "MMMM D, YYYY", "M/D/YYYY", or "D. MMMM YYYY".
 * @returns {string} The formatted date string in the "DD.MM.YYYY" format.
 * @throws {Error} Throws an error if the date string cannot be parsed into a valid date.
 */
function formatDate(dateString) {
    if (isValidDateFormat(dateString)) {
        return dateString
    } 

    let parsedDate;

    parsedDate = dayjs(dateString, [
        'MMMM D, YYYY',         
        'M/D/YYYY',             
        'D. MMMM YYYY'          
    ]);

    if (parsedDate.isValid()) {
        return parsedDate.format('DD.MM.YYYY');
    } else {
        throw new Error('Invalid date format');
    }
}

/**
 * Converts an amount in USD to EUR using a fixed exchange rate.
 * 
 * @param {number} usdAmount - The amount in USD to be converted to EUR.
 * @returns {number} The equivalent amount in EUR, based on the fixed exchange rate.
 *                   The returned value is rounded to two decimal places.
 */
function convertUSDToEUR(usdAmount) {
    const exchangeRate = 0.93; // Example exchange rate: 1 USD = 0,93 EUR
    const eurAmount = usdAmount * exchangeRate;
    return eurAmount.toFixed(2);
}

/**
 * Extracts relevant financial and invoice data (invoice number, date, net amount, gross amount, tax rate, and currency)
 * from a given text using regular expressions.
 * The function processes multiple possible formats for the data and returns an object containing:
 * - Invoice number
 * - Invoice date
 * - Net amount
 * - Gross amount
 * 
 * The function uses predefined regular expressions to find patterns in the text. It handles multiple formats for
 * dates, amounts, and currencies, and calculates the gross amount based on the extracted tax rate (if provided).
 * 
 * @param {string} text - The input text from which invoice data will be extracted. This can contain various
 *                        formats for the invoice number, date, amounts, and currency symbols.
 * @returns {object} An object containing the extracted invoice data:
 * - `rechnungs_nr`: The invoice number, or `null` if not found.
 * - `rechnungs_datum`: The invoice date, formatted as "DD.MM.YYYY", or `null` if not found.
 * - `gesamt_betrag_brutto`: The gross amount (after tax), or `null` if not found or if tax rate is 0.
 * - `gesamt_betrag_netto`: The net amount (before tax), or `null` if not found.
 * 
 * @throws {Error} If an error occurs during the extraction or processing, it logs the error and returns default values.
 */
function extractData(text) {
    try {
        // Define Regular Expressions
        const regexPatterns = {
            invoiceNumber: /(?:Rechnungsnummer|Invoice\s*number)\s*[:\s]*([A-Za-z0-9\s]+?)(?=\s*(?=\r|\n|$|[^A-Za-z0-9\s]))|pi_[a-zA-Z0-9]{23}|(?<=^|\n)\b(\d{4})\b(?=\s*(?:\r|\n|$))/i,
            invoiceDate: /(?:Rechnungsdatum|Datum|Lieferdatum|Date due)?\s*[:\s]*((?:\d{2}\.\d{2}\.\d{4})|(?:[A-Za-z]+ \d{1,2}, \d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{1,2}\. [A-Za-z]+ \d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4}))/i,
            netAmount: /(?:Total|Warenwert\s*netto|Gesamtbetrag|TOTAL\s*PAID)(?:\s*[:,]?\s*)?([€$]?)\s*([\d]{1,4}(?:[\.,]\d{3})*(?:[\.,]\d{2})?)(?:\s?[-,]?)?(?:\s*(?:€|\$|%))?|\b(?:Nettosumme)[^\d]*([\d]{1,3}(?:[\.,]\d{2}))\s*%?([\d]{1,3}(?:[\.,]\d{3})*(?:[\.,]\d{2})?)\s*([€$])\b/i,
            taxRate: /(\d{1,2})%/,
            currency: /(\$|€)/
        };

        // Extract Matches
        const invoiceNumberMatches = text.match(regexPatterns.invoiceNumber);
        const invoiceDateMatches = text.match(regexPatterns.invoiceDate);
        const netAmountMatches = text.match(regexPatterns.netAmount);
        const taxRateMatches = text.match(regexPatterns.taxRate);
        const currencyMatches = text.match(regexPatterns.currency);

        // Extract and Process Net Amount
        let netAmount = null, grossAmount = null, tax = null;

        if (netAmountMatches) {
            const filteredNetMatches = netAmountMatches.filter(match => match !== undefined);
            const netString = filteredNetMatches[2].replace(',', '.');
            netAmount = parseFloat(netString).toFixed(2);

            if (currencyMatches[0] === '$') {
                netAmount = convertUSDToEUR(netAmount);
            }

            tax = taxRateMatches ? taxRateMatches[1] : null;

            if (tax === 0) {
                grossAmount = netAmount;
            } else {
                grossAmount = calculateGrossAmount(netAmount, tax, currencyMatches[0]);
            }
        }

        // Prepare Extracted Data
        const extractedData = {
            rechnungs_nr: invoiceNumberMatches ? invoiceNumberMatches[1] || invoiceNumberMatches[0] : null,
            rechnungs_datum: invoiceDateMatches ? formatDate(invoiceDateMatches[1]) : null,
            gesamt_betrag_brutto: `${grossAmount}€`,
            gesamt_betrag_netto: `${netAmount}€`
        };

        return extractedData;
    } catch (error) {
        console.error("Error extracting data:", error.message);
        return {
            rechnungs_nr: null,
            rechnungs_datum: null,
            gesamt_betrag_brutto: null,
            gesamt_betrag_netto: null
        };
    }
}

/**
 * Processes a PDF file to extract relevant data using the `extractData` function.
 * It reads the PDF file, parses its content, and extracts the desired information 
 * (such as invoice number, date, net amount, and gross amount) from the parsed text.
 * 
 * @param {string} filePath - The file path of the PDF to be processed.
 * @returns {object|null} An object containing the extracted invoice data, 
 *                        or `null` if an error occurs during the processing.
 *                        The returned object may include keys such as:
 *                        - `rechnungs_nr` (Invoice number)
 *                        - `rechnungs_datum` (Invoice date)
 *                        - `gesamt_betrag_brutto` (Gross amount)
 *                        - `gesamt_betrag_netto` (Net amount)
 * 
 * @throws {Error} If there is an error reading or parsing the PDF file, 
 *                 it logs the error and returns `null`.
 */
async function processPDF(filePath){
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        return extractData(data.text);
    } catch (error) {
        console.error('Error while processing PDF:', error);
        return null;
    }
}

/**
 * Processes a TXT file to extract relevant data using the `extractData` function.
 * It reads the content of the TXT file and then extracts desired information 
 * (such as invoice number, date, net amount, and gross amount) from the text.
 * 
 * @param {string} filePath - The file path of the TXT file to be processed.
 * @returns {object|null} An object containing the extracted invoice data, 
 *                        or `null` if an error occurs during the processing.
 *                        The returned object may include keys such as:
 *                        - `rechnungs_nr` (Invoice number)
 *                        - `rechnungs_datum` (Invoice date)
 *                        - `gesamt_betrag_brutto` (Gross amount)
 *                        - `gesamt_betrag_netto` (Net amount)
 * 
 * @throws {Error} If there is an error reading the TXT file, it logs the error 
 *                 and returns `null`.
 */
function processTXT(filePath){
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        return extractData(content);
    } catch (error) {
        console.error('Error while processing TXT file:', error.message);
        return null;
    }
}

/**
 * Prompts the user to enter the name of a file to be read and returns the provided file name.
 * This function uses the `readline` module to interact with the user in the console.
 * It returns a Promise that resolves with the file name entered by the user.
 * 
 * @returns {Promise<string>} A Promise that resolves to the file name entered by the user.
 *                            The file name is returned as a string.
 */
function getFileName() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question("Enter the name of the file to be read: ", answer => {
        rl.close();
        resolve(answer);
    }));
}

/**
 * Recursively searches for a file with the specified name in a directory and its subdirectories.
 * If the file is found, it returns the full path to the file. If the file is not found, it returns `null`.
 * 
 * @param {string} dir - The directory to start searching in.
 * @param {string} fileName - The name of the file to search for (can include part of the name).
 * @returns {string|null} The full path of the file if found, or `null` if the file is not found.
 */
function searchFile(dir, fileName) {
    const files = fs.readdirSync(dir);

    for (const file of files) {
        const filePath = path.join(dir, file);
        const fileStat = fs.statSync(filePath);

        if (fileStat.isDirectory()) {
            const result = searchFile(filePath, fileName);
            if (result) return result;
        } else if (file.includes(fileName)) {
            return filePath;
        }
    }
    return null;
}

/**
 * Function to process data based on the file extension.
 * It delegates the processing to the appropriate function based on the file type.
 * Supported file extensions include 'txt' and 'pdf'.
 * 
 * @param {string} filePath - The path to the file that needs to be processed.
 * @param {string} extension - The extension of the file (e.g., 'txt' or 'pdf').
 * @returns {Promise<object|null>} A Promise that resolves to the extracted data object if successful,
 *                                or `null` if an error occurs or if the file type is not supported.
 */
async function getData(filePath, extension) {
    switch (extension) {
        case 'txt':
            return processTXT(filePath);
        case 'pdf':
            return await processPDF(filePath);
        default:
            console.error('This file type is not supported:', extension);
            return null;
    }
}

/**
 * Function to save the extracted data as a JSON file.
 * It converts the `extractedData` into a JSON string and writes it to a file named `Rechnungsdaten.json`.
 * 
 * @param {object} extractedData - The data to be saved in the JSON file. This should be an object 
 *                                  containing the extracted information.
 * @returns {Promise<void>} A Promise that resolves when the data is successfully written to the file,
 *                          or logs an error if writing the file fails.
 */
async function saveToJson(extractedData) {
    const jsonData = JSON.stringify(extractedData, null, 2);
    const jsonFilePath = './Rechnungsdaten.json';

    try {
        await fs.promises.writeFile(jsonFilePath, jsonData);
        console.log('Extracted data: ', extractedData);
        console.log("JSON file has been created successfully!");
        console.log('The data can be found in', jsonFilePath);
    } catch (error) {
        console.error("Error writing file:", error);
    }
}

/**
 * Main function that coordinates the process of searching for a file, extracting data, 
 * and saving the extracted data to a JSON file. 
 * 
 * The function follows these steps:
 * 1. Prompts the user to enter the file name.
 * 2. Searches for the file in the current directory and its subdirectories.
 * 3. Identifies the file extension (either `.txt` or `.pdf`).
 * 4. Extracts data from the file based on its extension.
 * 5. Saves the extracted data as a JSON file (`Rechnungsdaten.json`).
 * 
 * If any errors occur during the process (such as file not found, failed extraction, or file read/write errors),
 * the function logs the corresponding error messages.
 * 
 * @returns {Promise<void>} A Promise that resolves when the process completes, or logs an error if any step fails.
 */
async function main() {
    try {
        const fileName = await getFileName();
        const filePath = searchFile('./', fileName);

        if (!filePath) {
            console.error('File not found!');
            return;
        }

        const extension = filePath.split('.').pop().toLowerCase();
        const extractedData = await getData(filePath, extension);

        if (extractedData) {
            await saveToJson(extractedData);
        } else {
            console.error('Failed to extract data.');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}


main();